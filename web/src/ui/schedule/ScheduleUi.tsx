import { useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { newScheduleItem, SCHEDULE_KINDS, type ClassRoom, type ScheduleItem, type ScheduleKind, type StudentProgress } from '../../data/models';
import { ScheduleIcons } from '../../domain/iconStyles';
import { ScheduleLogic } from '../../domain/scheduleLogic';
import { SCHEDULE_FILTERS, ScheduleForms, ScheduleView, type ScheduleFilter } from '../../domain/scheduleView';
import { dayOf, monthLong, monthShort, noonMillis, parseDay, plusDays, today, weekday, weekdayLong, weekdayShort, type DayKey } from '../../domain/dates';
import { ConfirmDialog, DateField, DetailLine, Dialog, Field, PickerField, Spinner, StyledIcon, hexColor, useBack, CourseDot, NEUTRAL_ICON } from '../common';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { NoAccess, SubPage } from '../classroom/SubPage';
import { Tag } from '../ledger/LedgerUi';

export function kindLabel(kind: ScheduleKind): string {
  switch (kind) {
    case 'DEADLINE':
      return 'Deliverable';
    case 'QUIZ':
      return 'Quiz';
    case 'EXAM':
      return 'Exam';
    case 'RECITATION':
      return 'Recitation';
    case 'FCO':
      return 'Project';
  }
}

const GREEN = '#15803D';
const AMBER = '#B45309';
const RED = '#B91C1C';
const GREY = '#6B768A';

/** Most dots shown under a day in the week strip; more items show a "+". */
const MAX_DOTS = 3;

function statusColor(item: ScheduleItem, done: boolean, now: number): string {
  if (ScheduleLogic.isCancelled(item)) return GREY;
  if (done) return GREEN;
  if (ScheduleView.isOverdue(item, now)) return RED;
  // Only what needs attention now is colored; "In 6 days" stays quiet.
  return ScheduleView.dueLabel(item, now, done) === 'Today' ? AMBER : GREY;
}

/** The color of each open item's course (grey without one) per day, one dot per course. */
function courseDotsByDay(items: ScheduleItem[], doneIds: Set<string>, courses: { id: string; color?: string }[]): Map<DayKey, string[]> {
  const byDay = new Map<DayKey, string[]>();
  for (const it of items) {
    if (!ScheduleLogic.isOpen(it, doneIds)) continue;
    const color = courses.find((c) => c.id === it.courseId)?.color || NEUTRAL_ICON;
    const list = byDay.get(dayOf(it.dueMillis)) ?? [];
    if (!list.includes(color)) list.push(color);
    byDay.set(dayOf(it.dueMillis), list);
  }
  return byDay;
}

/** "Mon, Oct 19" */
export function longDay(day: DayKey): string {
  const { month, day: d } = parseDay(day);
  return `${weekdayShort(weekday(day))}, ${monthShort(month)} ${d}`;
}

/** "Oct 19" */
export function monthDay(day: DayKey): string {
  const { month, day: d } = parseDay(day);
  return `${monthShort(month)} ${d}`;
}

function dayHeader(day: DayKey, now: DayKey): string {
  if (day === now) return 'Today';
  if (day === plusDays(now, 1)) return 'Tomorrow';
  if (day === plusDays(now, -1)) return 'Yesterday';
  return longDay(day);
}

function KindBadge({ kind, room, tint = false, color }: { kind: ScheduleKind; room: ClassRoom | null; tint?: boolean; color?: string }) {
  // The class's chosen icon for this type, in the color of the item's course (grey without one).
  return (
    <StyledIcon
      icon={ScheduleIcons.iconFor(kind, room?.scheduleIcons ?? {})}
      color={color || NEUTRAL_ICON}
      label={kindLabel(kind)}
      box={tint ? 40 : 38}
      tint={tint}
    />
  );
}

/** A round tick the student clicks to mark an item done for themselves. */
function DoneCheck({ done, title, onToggle }: { done: boolean; title: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={'done-check' + (done ? ' on' : '')}
      aria-pressed={done}
      aria-label={done ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
      onClick={(e) => (e.stopPropagation(), onToggle())}
    >
      {done && '✓'}
    </button>
  );
}

/**
 * One schedule line. Used on the Schedule tab and in "Coming up" on Home.
 * onToggleDone shows the tick circle; leave it out for a read-only row.
 */
export function ScheduleRow({
  item,
  state,
  now,
  showDate,
  onClick,
  onToggleDone,
}: {
  item: ScheduleItem;
  state: ClassState;
  now: number;
  showDate: boolean;
  onClick?: () => void;
  onToggleDone?: (item: ScheduleItem, done: boolean) => void;
}) {
  const done = state.myDone.has(item.id);
  const cancelled = ScheduleLogic.isCancelled(item);
  const courseDoc = state.courses.find((c) => c.id === item.courseId);
  const course = courseDoc?.name;
  const subtitle = [course, state.takes(item.courseId) ? null : 'Not your course', kindLabel(item.kind), showDate ? longDay(dayOf(item.dueMillis)) : null].filter(Boolean).join('  ·  ');
  return (
    <div className={'list-row' + (onClick ? ' clickable' : '')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onClick()) : undefined}>
      <KindBadge kind={item.kind} room={state.room} tint color={courseDoc?.color} />
      <span className="grow ellipsis-box">
        <span className={'title' + (cancelled ? ' struck' : '') + (cancelled || done ? ' muted' : '')} style={{ display: 'block' }}>
          {item.title}
        </span>
        <span className="sub ellipsis">
          <CourseDot color={courseDoc?.color} />
          {subtitle}
        </span>
      </span>
      <Tag text={ScheduleView.dueLabel(item, now, done)} color={statusColor(item, done, now)} />
      {onToggleDone && !cancelled && <DoneCheck done={done} title={item.title} onToggle={() => onToggleDone(item, !done)} />}
    </div>
  );
}

/** One dot per course with something open that day, in the course's color (up to three, then a "+"). */
function DayDots({ colors }: { colors: string[] }) {
  return (
    <span className="dots" aria-hidden>
      {colors.slice(0, MAX_DOTS).map((color, i) => (
        <i key={i} style={{ background: hexColor(color) }} />
      ))}
      {colors.length > MAX_DOTS && <b>+</b>}
    </span>
  );
}

// ---------------------------------------------------------------- Schedule tab

export function ScheduleTab({
  state,
  selectedDay,
  onSelectDay,
  onEdit,
  onToggleDone,
  onSetCancelled,
}: {
  state: ClassState;
  selectedDay: DayKey | null;
  onSelectDay: (day: DayKey | null) => void;
  onEdit: (itemId: string) => void;
  onToggleDone: (item: ScheduleItem, done: boolean) => void;
  onSetCancelled: (item: ScheduleItem, cancelled: boolean) => void;
}) {
  const now = Date.now();
  const todayKey = today();
  const [anchor, setAnchor] = useState<DayKey>(selectedDay ?? todayKey);
  const [filter, setFilter] = useState<ScheduleFilter>('UPCOMING');
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [showMonth, setShowMonth] = useState(false);

  const week = ScheduleView.weekOf(anchor);
  const dotsByDay = useMemo(() => courseDotsByDay(state.schedule, state.myDone, state.courses), [state.schedule, state.myDone, state.courses]);
  const shown = selectedDay ? ScheduleView.onDay(state.schedule, selectedDay) : ScheduleView.filter(state.schedule, filter, now, state.myDone);
  const overdueCount = ScheduleView.filter(state.schedule, 'OVERDUE', now, state.myDone).length;
  const first = parseDay(week[0]);
  const last = parseDay(week[6]);
  let lastHeader = '';

  const emptyText =
    state.schedule.length === 0 && state.can('SCHEDULE_MANAGE')
      ? 'Nothing scheduled yet. Tap "+ Add" to add a deliverable, quiz or exam.'
      : state.schedule.length === 0
        ? 'Nothing scheduled yet. Officers who manage the schedule can add items here.'
        : selectedDay
          ? 'Nothing due on this day.'
          : filter === 'UPCOMING'
            ? 'You are all caught up.'
            : 'Nothing here for this filter.';

  // Show the live copy so a change is reflected while the dialog is open.
  const opened = openedId ? state.schedule.find((i) => i.id === openedId) : undefined;

  return (
    <div className="split">
      <div className="card week-card">
        {/* Wide screens have room beside the list, so they show the whole month; phones keep the week strip. */}
        <InlineMonth todayKey={todayKey} selectedDay={selectedDay} dotsByDay={dotsByDay} onSelectDay={onSelectDay} />
        <div className="row cal-narrow">
          <button type="button" className="btn text" aria-label="Previous week" onClick={() => setAnchor(plusDays(anchor, -7))}>
            ‹
          </button>
          <button type="button" className="btn text grow semibold" onClick={() => setShowMonth(true)}>
            {monthShort(first.month)} {first.day} – {monthShort(last.month)} {last.day}, {last.year}&nbsp;&nbsp;▾
          </button>
          <button type="button" className="btn text" aria-label="Next week" onClick={() => setAnchor(plusDays(anchor, 7))}>
            ›
          </button>
        </div>
        <div className="week cal-narrow">
          {week.map((day) => {
            const selected = day === selectedDay;
            return (
              <button
                key={day}
                type="button"
                className={'day' + (selected ? ' selected' : '') + (day === todayKey ? ' today' : '')}
                aria-pressed={selected}
                aria-label={longDay(day)}
                onClick={() => onSelectDay(selected ? null : day)}
              >
                <span className="tiny muted">{weekdayShort(weekday(day))}</span>
                <span className="num">{parseDay(day).day}</span>
                <DayDots colors={dotsByDay.get(day) ?? []} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="stack">
        {selectedDay ? (
          <div className="row">
            <span className="semibold grow">Due {longDay(selectedDay)}</span>
            <button type="button" className="btn text" onClick={() => onSelectDay(null)}>
              Show all
            </button>
          </div>
        ) : (
          <div className="chips" role="tablist" aria-label="Filter the schedule">
            {SCHEDULE_FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={f.id === filter} className={'chip' + (f.id === filter ? ' selected' : '')} onClick={() => setFilter(f.id)}>
                {f.id === 'OVERDUE' && overdueCount > 0 ? `${f.label} (${overdueCount})` : f.label}
              </button>
            ))}
          </div>
        )}
        <div className="card flush">
          {shown.length === 0 && <p className="empty">{emptyText}</p>}
          {shown.map((item) => {
            const header = dayHeader(dayOf(item.dueMillis), todayKey);
            const showHeader = !selectedDay && header !== lastHeader;
            lastHeader = header;
            return (
              <div key={item.id}>
                {showHeader && <div className="section-label">{header}</div>}
                <ScheduleRow item={item} state={state} now={now} showDate={false} onClick={() => setOpenedId(item.id)} onToggleDone={onToggleDone} />
              </div>
            );
          })}
        </div>
      </div>

      {showMonth && (
        <MonthCalendarDialog
          start={selectedDay ?? anchor}
          todayKey={todayKey}
          selectedDay={selectedDay}
          dotsByDay={dotsByDay}
          onPickDay={(day) => (setShowMonth(false), setAnchor(day), onSelectDay(day))}
          onToday={() => (setShowMonth(false), setAnchor(todayKey), onSelectDay(null))}
          onDismiss={() => setShowMonth(false)}
        />
      )}

      {opened && (
        <ScheduleDetailsDialog
          item={opened}
          state={state}
          progress={state.progress}
          now={now}
          onDismiss={() => setOpenedId(null)}
          onEdit={() => (setOpenedId(null), onEdit(opened.id))}
          onToggleDone={(done) => onToggleDone(opened, done)}
          onSetCancelled={(cancelled) => (setOpenedId(null), onSetCancelled(opened, cancelled))}
        />
      )}
    </div>
  );
}

/** The month shown in place on wide screens. Tapping a day filters the list to it; tapping it again shows all. */
function InlineMonth({ todayKey, selectedDay, dotsByDay, onSelectDay }: { todayKey: DayKey; selectedDay: DayKey | null; dotsByDay: Map<DayKey, string[]>; onSelectDay: (day: DayKey | null) => void }) {
  const startParts = parseDay(selectedDay ?? todayKey);
  const [ym, setYm] = useState({ year: startParts.year, month: startParts.month });
  const shift = (by: number) => {
    const index = ym.year * 12 + (ym.month - 1) + by;
    setYm({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };
  const today = parseDay(todayKey);
  const onThisMonth = ym.year === today.year && ym.month === today.month;
  return (
    <div className="cal-wide">
      <div className="row">
        <button type="button" className="btn text" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="grow center semibold">
          {monthLong(ym.month)} {ym.year}
        </span>
        <button type="button" className="btn text" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="week">
        {ScheduleView.weekOf(todayKey).map((d) => (
          <span key={d} className="tiny muted center">
            {weekdayShort(weekday(d))}
          </span>
        ))}
        {ScheduleView.monthGrid(ym.year, ym.month).map((day, i) =>
          day === null ? (
            <span key={`b${i}`} className="day blank" />
          ) : (
            <button
              key={day}
              type="button"
              className={'day small-day' + (day === selectedDay ? ' selected' : '') + (day === todayKey ? ' today' : '')}
              aria-pressed={day === selectedDay}
              aria-label={longDay(day)}
              onClick={() => onSelectDay(day === selectedDay ? null : day)}
            >
              <span className="num">{parseDay(day).day}</span>
              <DayDots colors={dotsByDay.get(day) ?? []} />
            </button>
          ),
        )}
      </div>
      {(!onThisMonth || selectedDay) && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn text" onClick={() => (setYm({ year: today.year, month: today.month }), onSelectDay(null))}>
            Back to today
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The whole month with the same dots as the week strip. Picking a day shows that day's week
 * with the day chosen; Today goes back to this week.
 */
function MonthCalendarDialog({
  start,
  todayKey,
  selectedDay,
  dotsByDay,
  onPickDay,
  onToday,
  onDismiss,
}: {
  start: DayKey;
  todayKey: DayKey;
  selectedDay: DayKey | null;
  dotsByDay: Map<DayKey, string[]>;
  onPickDay: (day: DayKey) => void;
  onToday: () => void;
  onDismiss: () => void;
}) {
  const startParts = parseDay(start);
  const [ym, setYm] = useState({ year: startParts.year, month: startParts.month });
  const shift = (by: number) => {
    const index = ym.year * 12 + (ym.month - 1) + by;
    setYm({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };
  const grid = ScheduleView.monthGrid(ym.year, ym.month);
  return (
    <Dialog
      title={
        <span className="row">
          <button type="button" className="btn text" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="grow center" style={{ fontSize: 17 }}>
            {monthLong(ym.month)} {ym.year}
          </span>
          <button type="button" className="btn text" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
        </span>
      }
      onClose={onDismiss}
      actions={
        <>
          <button className="btn text" onClick={onToday}>
            Today
          </button>
          <button className="btn text" onClick={onDismiss}>
            Close
          </button>
        </>
      }
    >
      <div className="week">
        {ScheduleView.weekOf(todayKey).map((d) => (
          <span key={d} className="tiny muted center">
            {weekdayShort(weekday(d))}
          </span>
        ))}
        {grid.map((day, i) =>
          day === null ? (
            <span key={`b${i}`} className="day blank" />
          ) : (
            <button
              key={day}
              type="button"
              className={'day small-day' + (day === selectedDay ? ' selected' : '') + (day === todayKey ? ' today' : '')}
              aria-label={longDay(day)}
              onClick={() => onPickDay(day)}
            >
              <span className="num">{parseDay(day).day}</span>
              <DayDots colors={dotsByDay.get(day) ?? []} />
            </button>
          ),
        )}
      </div>
    </Dialog>
  );
}

function ScheduleDetailsDialog({
  item,
  state,
  progress,
  now,
  onDismiss,
  onEdit,
  onToggleDone,
  onSetCancelled,
}: {
  item: ScheduleItem;
  state: ClassState;
  progress: StudentProgress[];
  now: number;
  onDismiss: () => void;
  onEdit: () => void;
  onToggleDone: (done: boolean) => void;
  onSetCancelled: (cancelled: boolean) => void;
}) {
  const canManage = state.can('SCHEDULE_MANAGE');
  const done = state.myDone.has(item.id);
  const cancelled = ScheduleLogic.isCancelled(item);
  const course = state.courses.find((c) => c.id === item.courseId)?.name;
  const [showWho, setShowWho] = useState(false);
  const due = dayOf(item.dueMillis);
  const dueParts = parseDay(due);
  // Only the students who take the course are expected to finish it.
  const takers = item.courseId ? state.members.filter((m) => !m.excludedCourseIds.includes(item.courseId)) : state.members;
  const summary = ScheduleView.completion(item.id, takers, progress);

  return (
    <Dialog
      title={item.title}
      onClose={onDismiss}
      actions={
        <>
          {canManage && (
            <button className="btn text" style={{ marginRight: 'auto' }} onClick={onEdit}>
              Edit
            </button>
          )}
          <button className="btn text" onClick={onDismiss}>
            Close
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 6 }}>
        <div className="row">
          <KindBadge kind={item.kind} room={state.room} color={state.courses.find((c) => c.id === item.courseId)?.color} />
          <Tag text={ScheduleView.dueLabel(item, now, done)} color={statusColor(item, done, now)} />
        </div>
        <DetailLine label="Type" value={kindLabel(item.kind)} width={76} />
        <DetailLine label="Course" value={course ?? 'Whole class'} width={76} />
        <DetailLine label="Due" value={`${weekdayLong(weekday(due))}, ${monthLong(dueParts.month)} ${dueParts.day}, ${dueParts.year}`} width={76} />
        {item.note.trim() && <DetailLine label="Note" value={item.note} width={76} />}

        {cancelled ? (
          <p className="semibold" style={{ color: GREY, margin: 0 }}>This was cancelled for the whole class.</p>
        ) : (
          <>
            {done ? (
              <button className="btn outline block" onClick={() => onToggleDone(false)}>
                Mark as not done
              </button>
            ) : (
              <button className="btn solid block" onClick={() => onToggleDone(true)}>
                Mark as done
              </button>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Only you can change your own mark. Everyone in the class can see who has marked it done.
            </p>
            <hr className="divider" />
            <div className="row">
              <span className="semibold grow">
                Marked done by {summary.done.length} of {summary.total}
              </span>
              <button className="btn text small" onClick={() => setShowWho(!showWho)}>
                {showWho ? 'Hide' : 'See who'}
              </button>
            </div>
            {showWho && (
              <>
                {summary.done.length > 0 && (
                  <>
                    <div className="small bold" style={{ color: GREEN }}>Done</div>
                    {summary.done.map((m) => (
                      <div key={m.id} className="small">• {m.name}</div>
                    ))}
                  </>
                )}
                {summary.notDone.length > 0 && (
                  <>
                    <div className="small bold" style={{ color: AMBER }}>Not yet</div>
                    {summary.notDone.map((m) => (
                      <div key={m.id} className="small">• {m.name}</div>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {canManage && (
          <>
            <hr className="divider" />
            <div className="small bold muted">FOR OFFICERS</div>
            <button className="btn outline block" onClick={() => onSetCancelled(!cancelled)}>
              {cancelled ? 'Restore for the class' : 'Cancel for the whole class'}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Add / edit form

/** /class/:classId/schedule/:itemId ("new" when adding, with an optional ?day=YYYY-MM-DD). */
export function ScheduleFormScreen() {
  const { itemId = 'new' } = useParams();
  const [params] = useSearchParams();
  const { state, actions } = useClass();
  const isNew = itemId === 'new';
  const existing = isNew ? undefined : state.schedule.find((i) => i.id === itemId);
  const title = existing ? 'Edit schedule item' : 'Add to schedule';

  if (!state.loading && !state.can('SCHEDULE_MANAGE')) {
    return (
      <SubPage title={title}>
        <NoAccess what="manage the schedule" />
      </SubPage>
    );
  }
  if (!state.loading && !isNew && !existing) {
    return (
      <SubPage title={title}>
        <p className="empty">This item was deleted.</p>
      </SubPage>
    );
  }
  const day = params.get('day');
  return (
    <SubPage title={title}>
      <ScheduleForm key={existing?.id ?? 'new'} existing={existing} defaultDay={day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null} busy={actions.busy} />
    </SubPage>
  );
}

function ScheduleForm({ existing, defaultDay, busy }: { existing: ScheduleItem | undefined; defaultDay: DayKey | null; busy: boolean }) {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}?tab=SCHEDULE`);
  const [kind, setKind] = useState<ScheduleKind>(existing?.kind ?? 'DEADLINE');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [courseId, setCourseId] = useState(existing?.courseId ?? '');
  const [dueMillis, setDueMillis] = useState(() => existing?.dueMillis ?? noonMillis(defaultDay ?? today()));
  const [cancelled, setCancelled] = useState(existing ? ScheduleLogic.isCancelled(existing) : false);
  const [note, setNote] = useState(existing?.note ?? '');
  const [pickingCourse, setPickingCourse] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const courseName = state.courses.find((c) => c.id === courseId)?.name ?? 'Whole class (no course)';

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = ScheduleForms.check(title);
    setError(problem);
    if (problem) return;
    actions.saveScheduleItem(
      newScheduleItem({
        id: existing?.id ?? '',
        courseId,
        title,
        kind,
        dueMillis,
        status: cancelled ? 'CANCELLED' : 'PENDING',
        note,
        createdByUid: existing?.createdByUid ?? '',
      }),
      back,
    );
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <p className="small muted" style={{ margin: 0 }}>
        Everyone in the class sees this. Each student marks it done for themselves.
      </p>
      <span className="small semibold muted">Type</span>
      <div className="chips" role="radiogroup" aria-label="Type">
        {SCHEDULE_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind} className={'chip' + (k === kind ? ' selected' : '')} onClick={() => setKind(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <Field label="Title">
        <input value={title} placeholder="e.g. Midterm Exam, Assignment #3" onChange={(e) => (setTitle(e.target.value.slice(0, ScheduleForms.MAX_TITLE)), setError(null))} />
      </Field>
      <PickerField label="Course" value={courseName} onClick={() => setPickingCourse(true)} />
      <DateField label="Due date" dayOnly millis={dueMillis} onChange={setDueMillis} />
      {existing && (
        <>
          <span className="small semibold muted">For the whole class</span>
          <div className="chips" role="radiogroup" aria-label="For the whole class">
            <button type="button" role="radio" aria-checked={!cancelled} className={'chip' + (!cancelled ? ' selected' : '')} onClick={() => setCancelled(false)}>
              Active
            </button>
            <button type="button" role="radio" aria-checked={cancelled} className={'chip' + (cancelled ? ' selected' : '')} onClick={() => setCancelled(true)}>
              Cancelled
            </button>
          </div>
        </>
      )}
      <Field label="Note (optional)">
        <textarea value={note} placeholder="e.g. Covers Units 1 to 3, bring a calculator" onChange={(e) => setNote(e.target.value.slice(0, 160))} />
      </Field>
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn solid big block" type="submit" disabled={busy}>
        {busy ? <Spinner small /> : existing ? 'Save changes' : 'Add to schedule'}
      </button>
      {existing && (
        <button className="btn outline danger block" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      )}

      {pickingCourse && (
        <Dialog
          title="Course"
          onClose={() => setPickingCourse(false)}
          actions={
            <button type="button" className="btn text" onClick={() => setPickingCourse(false)}>
              Cancel
            </button>
          }
        >
          <div className="scroll-list">
            <button type="button" className="list-row" onClick={() => (setCourseId(''), setPickingCourse(false))}>
              Whole class (no course)
            </button>
            {state.courses.map((c) => (
              <button key={c.id} type="button" className="list-row" onClick={() => (setCourseId(c.id), setPickingCourse(false))}>
                {c.name}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {confirmDelete && existing && (
        <ConfirmDialog
          title={`Delete "${existing.title}"?`}
          text="It will be removed from the schedule for everyone in the class."
          confirm="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => actions.deleteScheduleItem(existing, back)}
        />
      )}
    </form>
  );
}

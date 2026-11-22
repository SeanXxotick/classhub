import { useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { useHistory, type HistoryEntry, type HistoryGroup, type HistoryKind } from '../../data/history';
import { Button, Card, DayHeader, FilterChips, ListRow, Notice, SearchInput, Select, TextInput, TypeIcon, type IconName, type Tone } from '../../design';
import { Spinner } from '../common';
import { useClass } from './ClassContext';
import { NoAccess, SubPage } from './SubPage';

const PAGE = 50;

const LOOK: Record<HistoryKind, [IconName, Tone]> = {
  PAYMENT: ['income', 'income'],
  WITHDRAWAL: ['withdrawal', 'withdrawal'],
  OPENING: ['coins', 'opening'],
  OPENING_PENDING: ['hourglass', 'opening'],
  CHARGE: ['charge', 'charge'],
  PAYOUT: ['payout', 'payout'],
  VOID: ['ban', 'danger'],
  CLAIM_CONFIRMED: ['check', 'success'],
  CLAIM_REJECTED: ['x', 'danger'],
  LEDGER_SETTINGS: ['ledger', 'neutral'],
  JOIN_APPROVED: ['userplus', 'success'],
  JOIN_REJECTED: ['x', 'danger'],
  MEMBER_REMOVED: ['logout', 'danger'],
  MEMBER_LEFT: ['logout', 'neutral'],
  MEMBER_ROLE: ['shield', 'primary'],
  MEMBER_COURSES: ['book', 'neutral'],
  ROLE_SAVED: ['shield', 'primary'],
  ROLE_DELETED: ['trash', 'danger'],
  MAYOR_HANDOVER: ['key', 'warning'],
  INVITE_CODE: ['key', 'neutral'],
  CLASS_SETTINGS: ['sliders', 'neutral'],
  CLASS_PHOTO: ['camera', 'neutral'],
  REMINDERS: ['bell', 'warning'],
  ANNOUNCEMENT_POSTED: ['news', 'primary'],
  ANNOUNCEMENT_EDITED: ['edit', 'neutral'],
  ANNOUNCEMENT_DELETED: ['trash', 'danger'],
  ANNOUNCEMENT_PINNED: ['pin', 'neutral'],
  COMMENT_REMOVED: ['comment', 'danger'],
  FORUM_MODERATED: ['eye', 'warning'],
  FORUM_QUESTION_DELETED: ['trash', 'danger'],
  FORUM_ANSWER_REMOVED: ['comment', 'danger'],
  ATTENDANCE_TAKEN: ['list', 'success'],
  ATTENDANCE_REPLACED: ['edit', 'warning'],
  ATTENDANCE_REMOVED: ['trash', 'danger'],
  NO_CLASS_MARKED: ['ban', 'warning'],
  NO_CLASS_REMOVED: ['schedule', 'success'],
  MEETING_ADDED: ['clock', 'primary'],
  MEETING_EDITED: ['clock', 'neutral'],
  MEETING_DELETED: ['trash', 'danger'],
  SCHEDULE_EDITED: ['schedule', 'neutral'],
  SCHEDULE_DELETED: ['trash', 'danger'],
  COURSE_ADDED: ['book', 'primary'],
  COURSE_EDITED: ['book', 'neutral'],
  COURSE_DELETED: ['trash', 'danger'],
  CONTENT_EDITED: ['contents', 'neutral'],
  CONTENT_DELETED: ['trash', 'danger'],
  POLL_CREATED: ['list', 'primary'],
  POLL_CLOSED: ['lock', 'warning'],
  POLL_DELETED: ['trash', 'danger'],
};

type Show = 'ALL' | HistoryGroup;
const SHOW: { value: Show; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'MONEY', label: 'Money' },
  { value: 'ATTENDANCE', label: 'Attendance' },
  { value: 'SCHEDULE', label: 'Schedule and courses' },
  { value: 'NEWS', label: 'News and Forum' },
  { value: 'CONTENTS', label: 'Contents' },
  { value: 'PEOPLE', label: 'Members and roles' },
  { value: 'SETTINGS', label: 'Class settings' },
];

const dayLabel = (millis: number) => new Date(millis).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (millis: number) => new Date(millis).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** The end of a picked day (YYYY-MM-DD) in Philippine time. */
const endOfDay = (day: string) => (day ? new Date(`${day}T23:59:59.999+08:00`).getTime() : 0);

/**
 * The history log of officer actions, newest first (CLASS_SETTINGS). The kind, officer and date filters run
 * in Firestore, so an older entry is found however busy the log is; the search looks through what is loaded.
 * Entries cannot be edited or deleted by anyone; they go only when the class is deleted.
 */
export function HistoryScreen() {
  const { state } = useClass();
  const allowed = state.can('CLASS_SETTINGS');
  const [count, setCount] = useState(PAGE);
  const [show, setShowRaw] = useState<Show>('ALL');
  const [by, setByRaw] = useState('');
  const [upTo, setUpToRaw] = useState('');
  const [search, setSearch] = useState('');
  // A new filter starts again from the newest page.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setCount(PAGE);
  };
  const setShow = reset(setShowRaw);
  const setBy = reset(setByRaw);
  const setUpTo = reset(setUpToRaw);

  const { data, error } = useHistory(db, state.classId, count, allowed, {
    group: show === 'ALL' ? undefined : show,
    actorUid: by || undefined,
    upToMillis: endOfDay(upTo) || undefined,
  });
  const nameOf = (e: HistoryEntry) => state.members.find((m) => m.id === e.actorUid)?.name ?? (e.actorName ? `${e.actorName} (left the class)` : 'A former officer');
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (data ?? []).filter((e) => {
    const hay = `${e.text} ${nameOf(e)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const filtered = show !== 'ALL' || !!by || !!upTo || words.length > 0;
  const people = [...state.members].sort((a, b) => a.name.localeCompare(b.name));

  // Group by day, keeping the newest-first order.
  const days: { label: string; entries: HistoryEntry[] }[] = [];
  for (const e of shown) {
    const label = dayLabel(e.atMillis);
    if (days.at(-1)?.label === label) days.at(-1)!.entries.push(e);
    else days.push({ label, entries: [e] });
  }

  return (
    <SubPage title="History log">
      {!allowed ? (
        <NoAccess what="see the history log" />
      ) : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            Officer actions. Entries cannot be edited or deleted.
          </p>
          <div className="history-show">
            <FilterChips label="Show" value={show} onChange={setShow} options={SHOW} />
          </div>
          <div className="history-filters">
            <SearchInput aria-label="Search the history log" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select aria-label="Done by" value={by} onChange={(e) => setBy(e.target.value)}>
              <option value="">Anyone</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <TextInput type="date" aria-label="Up to this day" title="Up to this day" value={upTo} onChange={(e) => setUpTo(e.target.value)} />
            {filtered && (
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  setShow('ALL');
                  setBy('');
                  setUpTo('');
                  setSearch('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
          {error && (
            <Notice tone={(error as { code?: string }).code === 'failed-precondition' ? 'info' : 'danger'}>
              {/* A filter whose index is still being built (right after a deploy) answers failed-precondition. */}
              {(error as { code?: string }).code === 'failed-precondition'
                ? 'This filter is still being set up. Try again in a few minutes.'
                : friendlyMessage(error)}
            </Notice>
          )}
          {!data && !error && <Spinner />}
          {data && !error && shown.length === 0 && (
            <p className="empty">
              {!filtered && data.length === 0
                ? 'Nothing yet. Officer actions show here from now on.'
                : data.length === count
                  ? 'Nothing matches in the entries loaded. Show older to look further back.'
                  : 'Nothing matches.'}
            </p>
          )}
          {days.map((day) => (
            <Card flush key={day.label}>
              <DayHeader>{day.label}</DayHeader>
              {day.entries.map((e) => {
                const [icon, tone] = LOOK[e.kind];
                return (
                  <ListRow
                    key={e.id}
                    leading={<TypeIcon icon={icon} tone={tone} />}
                    title={e.text}
                    subtitle={`${nameOf(e)} · ${timeLabel(e.atMillis)}`}
                  />
                );
              })}
            </Card>
          ))}
          {data && data.length === count && (
            <Button variant="text" icon="down" onClick={() => setCount(count + PAGE)}>
              Show older
            </Button>
          )}
        </div>
      )}
    </SubPage>
  );
}

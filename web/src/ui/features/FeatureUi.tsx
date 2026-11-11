import { useEffect, useMemo, useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import {
  CLAIM_METHODS,
  CLAIM_METHOD_LABELS,
  addNoClass,
  cancelClaim,
  clockText,
  confirmClaim,
  deleteAnnouncement,
  deleteMeeting,
  manilaDay,
  markSeen,
  meetingsOn,
  newAnnouncement,
  newMeeting,
  rejectClaim,
  removeNoClass,
  saveAnnouncement,
  saveMeeting,
  sendClaim,
  useAnnouncements,
  useClaims,
  useMeetings,
  useNoClass,
  useSeen,
  type Announcement,
  type Claim,
  type ClaimMethod,
  type Meeting,
} from '../../data/features';
import { Ledger } from '../../domain/ledger';
import { formatMoney, parsePesos } from '../../domain/money';
import { Dialog, Field, shortDate } from '../common';
import { useClass, type ClassState } from '../classroom/ClassContext';

/** Runs a write and shows the result in the snackbar. */
function useRun() {
  const { actions } = useClass();
  return (success: string, work: () => Promise<unknown>, onDone?: () => void) => {
    work()
      .then(() => (actions.showNotice(success), onDone?.()))
      .catch((e) => actions.showNotice(friendlyMessage(e)));
  };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------- Payment claims

const CLAIM_STATUS: Record<Claim['status'], string> = { PENDING: 'Waiting for the Treasurer', CONFIRMED: 'Confirmed', REJECTED: 'Rejected' };

/** In the Ledger tab: "I paid" for students, and the list of claims to decide for records managers. */
export function ClaimsCard({ state }: { state: ClassState }) {
  const manage = state.can('RECORDS_MANAGE');
  const claims = useClaims(db, state.classId, state.myUid, true, manage).data ?? [];
  const run = useRun();
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<Claim | null>(null);
  const [reason, setReason] = useState('');
  const waiting = claims.filter((c) => c.status === 'PENDING');
  const mine = claims.filter((c) => c.memberId === state.myUid).slice(0, 5);
  const references = waiting.map((c) => c.reference.trim().toLowerCase()).filter(Boolean);
  const repeated = (c: Claim) => !!c.reference.trim() && references.filter((r) => r === c.reference.trim().toLowerCase()).length > 1;

  return (
    <div className="card stack">
      <div className="row">
        <span className="bold grow">Payment claims{manage && waiting.length > 0 ? ` (${waiting.length} waiting)` : ''}</span>
        <button type="button" className="btn outline" onClick={() => setAdding(true)}>
          I paid
        </button>
      </div>
      {manage &&
        waiting.map((c) => (
          <div key={c.id} className="stack" style={{ gap: 4 }}>
            <div>
              <span className="semibold">{c.memberName}</span> says they paid <span className="bold">{formatMoney(c.amountCentavos)}</span> by {CLAIM_METHOD_LABELS[c.method]}
              {c.reference ? `, reference ${c.reference}` : ''}
              {c.note ? ` (${c.note})` : ''} on {shortDate(c.createdAtMillis)}.
            </div>
            {repeated(c) && <div className="error-text small">Another waiting claim has the same reference number.</div>}
            <div className="row">
              <button type="button" className="btn text danger" onClick={() => (setReason(''), setRejecting(c))}>
                Reject
              </button>
              <button
                type="button"
                className="btn solid"
                onClick={() => run(`Payment of ${formatMoney(c.amountCentavos)} from ${c.memberName} confirmed.`, () => confirmClaim(db, state.myUid, state.classId, c))}
              >
                Confirm
              </button>
            </div>
          </div>
        ))}
      {mine.length > 0 && <div className="small semibold muted">Your claims</div>}
      {mine.map((c) => (
        <div key={c.id} className="row">
          <span className="grow">
            <span className="semibold">{formatMoney(c.amountCentavos)}</span> · {CLAIM_METHOD_LABELS[c.method]} · {shortDate(c.createdAtMillis)}
            <span className="small muted" style={{ display: 'block' }}>
              {CLAIM_STATUS[c.status]}
              {c.status === 'REJECTED' ? `: ${c.rejectReason}` : ''}
            </span>
          </span>
          {c.status === 'PENDING' && (
            <button type="button" className="btn text" onClick={() => run('Claim cancelled.', () => cancelClaim(db, state.classId, c.id))}>
              Cancel
            </button>
          )}
        </div>
      ))}
      {!manage && mine.length === 0 && <p className="small muted" style={{ margin: 0 }}>Paid by GCash or bank? Tap "I paid" so the Treasurer can confirm it.</p>}
      {adding && <ClaimDialog state={state} onClose={() => setAdding(false)} />}
      {rejecting && (
        <Dialog
          title="Reject this claim?"
          onClose={() => setRejecting(null)}
          actions={
            <>
              <button className="btn text" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button
                className="btn text danger"
                disabled={!reason.trim()}
                onClick={() => run('Claim rejected.', () => rejectClaim(db, state.myUid, state.classId, rejecting.id, reason), () => setRejecting(null))}
              >
                Reject claim
              </button>
            </>
          }
        >
          <Field label="Reason (the student sees it)">
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

function ClaimDialog({ state, onClose }: { state: ClassState; onClose: () => void }) {
  const run = useRun();
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<ClaimMethod>('GCASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const amount = parsePesos(amountText);
  return (
    <Dialog
      title="I paid"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn solid"
            disabled={amount === null}
            onClick={() =>
              amount !== null &&
              run('Claim sent. It is waiting for the Treasurer.', () =>
                sendClaim(db, { uid: state.myUid, name: state.me?.name ?? '' }, state.classId, { amountCentavos: amount, method, reference, note }), onClose)
            }
          >
            Send claim
          </button>
        </>
      }
    >
      <div className="stack">
        {state.room?.paymentInfo.trim() && <p className="small muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{state.room.paymentInfo}</p>}
        <Field label="Amount">
          <input value={amountText} inputMode="decimal" placeholder="0.00" onChange={(e) => setAmountText(e.target.value)} />
        </Field>
        <Field label="Paid by">
          <select value={method} onChange={(e) => setMethod(e.target.value as ClaimMethod)}>
            {CLAIM_METHODS.map((m) => (
              <option key={m} value={m}>
                {CLAIM_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference number (optional)">
          <input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Statement and export

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const pesos = (centavos: number) => (centavos / 100).toFixed(2);

/** In the Ledger tab: a student's statement with a running balance, and the CSV export for those who see every record. */
export function StatementCard({ state }: { state: ClassState }) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => {
    const mine = state.records.filter((r) => r.memberId === state.myUid && !r.voidedAtMillis).sort((a, b) => a.dateMillis - b.dateMillis);
    let balance = 0;
    return mine.map((r) => {
      const change = Ledger.memberBalances([{ id: state.myUid } as never], [r]).get(state.myUid) ?? 0;
      balance += change;
      return { r, change, balance };
    });
  }, [state.records, state.myUid]);

  function exportCsv() {
    const head = ['Date', 'Type', 'Student', 'Amount', 'Note', 'Paid to', 'Voided', 'Void reason'].map(cell).join(',');
    const rows = [...state.records]
      .sort((a, b) => a.dateMillis - b.dateMillis)
      .map((r) => [manilaDay(r.dateMillis).dateKey, r.type, r.memberName, pesos(r.amountCentavos), r.note, r.paidTo, r.voidedAtMillis ? 'yes' : '', r.voidReason].map(cell).join(','));
    const balances = state.members.map((m) => [m.name, pesos(state.balanceOf(m.id))].map(cell).join(','));
    download(`${state.room?.name ?? 'class'} ledger.csv`, [head, ...rows, '', [cell('Student'), cell('Balance')].join(','), ...balances].join('\r\n'));
  }

  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="btn outline" onClick={() => setOpen(true)}>
        My statement
      </button>
      {state.seeAll && (
        <button type="button" className="btn outline" onClick={exportCsv}>
          Export CSV
        </button>
      )}
      {open && (
        <Dialog
          title={`Statement of ${state.me?.name ?? ''}`}
          onClose={() => setOpen(false)}
          actions={
            <>
              <button className="btn text" onClick={() => window.print()}>
                Print
              </button>
              <button className="btn text" onClick={() => setOpen(false)}>
                Close
              </button>
            </>
          }
        >
          {lines.length === 0 && <p className="muted">No records yet.</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {lines.map(({ r, change, balance }) => (
                <tr key={r.id}>
                  <td style={{ padding: '4px 6px 4px 0' }}>{shortDate(r.dateMillis)}</td>
                  <td style={{ padding: '4px 6px' }}>{r.note || r.type.toLowerCase()}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{(change >= 0 ? '+' : '−') + formatMoney(Math.abs(change))}</td>
                  <td style={{ padding: '4px 0 4px 6px', textAlign: 'right', fontWeight: 700 }}>{formatMoney(balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Announcements

export function NewsTab({ state }: { state: ClassState }) {
  const manage = state.can('ANNOUNCEMENTS_MANAGE');
  const posts = useAnnouncements(db, state.classId, true).data;
  const seen = useSeen(db, state.classId, true).data ?? [];
  const run = useRun();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const mySeen = seen.find((s) => s.id === state.myUid)?.announcements ?? {};
  const unseen = (posts ?? []).filter((p) => !mySeen[p.id]).map((p) => p.id).join(',');

  // Showing the list counts as opening the posts.
  useEffect(() => {
    if (unseen) markSeen(db, state.classId, state.myUid, unseen.split(',')).catch(() => {});
  }, [unseen, state.classId, state.myUid]);

  const author = (uid: string) => state.members.find((m) => m.id === uid)?.name ?? 'a former member';
  const seenBy = (id: string) => seen.filter((s) => s.announcements[id] && state.members.some((m) => m.id === s.id)).length;

  return (
    <div className="stack">
      {manage && (
        <button type="button" className="btn solid" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(newAnnouncement({}))}>
          New announcement
        </button>
      )}
      {posts && posts.length === 0 && <p className="empty">No announcements yet.</p>}
      {(posts ?? []).map((p) => (
        <div key={p.id} className="card stack" style={{ gap: 6 }}>
          <div className="bold" style={{ fontSize: 17 }}>
            {p.pinned ? 'Pinned · ' : ''}
            {p.title}
          </div>
          {p.body && <div style={{ whiteSpace: 'pre-wrap' }}>{p.body}</div>}
          <div className="small muted">
            {author(p.createdByUid)} · {shortDate(p.createdAtMillis)}
            {p.editedAtMillis ? ' · edited' : ''}
            {manage ? ` · Seen by ${seenBy(p.id)} of ${state.members.length}` : ''}
          </div>
          {manage && (
            <div className="row">
              <button type="button" className="btn text" onClick={() => setEditing(p)}>
                Edit
              </button>
              <button type="button" className="btn text" onClick={() => run(p.pinned ? 'Unpinned.' : 'Pinned.', () => saveAnnouncement(db, state.myUid, state.classId, { ...p, pinned: !p.pinned }))}>
                {p.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button type="button" className="btn text danger" onClick={() => window.confirm(`Delete "${p.title}"?`) && run('Announcement deleted.', () => deleteAnnouncement(db, state.classId, p.id))}>
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
      {editing && <PostDialog state={state} post={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PostDialog({ state, post, onClose }: { state: ClassState; post: Announcement; onClose: () => void }) {
  const run = useRun();
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [pinned, setPinned] = useState(post.pinned);
  return (
    <Dialog
      title={post.id ? 'Edit announcement' : 'New announcement'}
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn solid"
            disabled={!title.trim()}
            onClick={() => run(post.id ? 'Announcement saved.' : 'Announcement posted.', () => saveAnnouncement(db, state.myUid, state.classId, { ...post, title, body, pinned }), onClose)}
          >
            {post.id ? 'Save' : 'Post'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Title">
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Message">
          <textarea value={body} rows={6} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <label className="row">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top
        </label>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Timetable

const toClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const fromClock = (text: string) => {
  const [h, m] = text.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Today and tomorrow, for Home. Shows nothing when the class has no timetable. */
export function TodayCard({ state }: { state: ClassState }) {
  const meetings = useMeetings(db, state.classId, true).data ?? [];
  const marks = useNoClass(db, state.classId, true).data ?? [];
  if (meetings.length === 0) return null;
  const now = Date.now();
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const mine = (m: Meeting) => !state.me?.excludedCourseIds.includes(m.courseId);
  return (
    <div className="card stack" style={{ gap: 6 }}>
      {[
        ['Today', now],
        ['Tomorrow', now + 86_400_000],
      ].map(([label, at]) => {
        const list = meetingsOn(meetings, marks, at as number).filter((x) => mine(x.meeting));
        return (
          <div key={label as string}>
            <div className="small semibold muted">{label}</div>
            {list.length === 0 && <div className="muted">No classes.</div>}
            {list.map(({ meeting: m, cancelled }) => (
              <div key={m.id} style={cancelled ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                {clockText(m.startMinutes)} to {clockText(m.endMinutes)} · <span className="semibold">{courseName(m.courseId)}</span>
                {m.room ? ` · ${m.room}` : ''}
                {cancelled ? ` · No classes${cancelled.reason ? `: ${cancelled.reason}` : ''}` : ''}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** The weekly timetable, in the Schedule tab. Officers with the schedule permission edit it and mark "no classes". */
export function TimetableCard({ state }: { state: ClassState }) {
  const manage = state.can('SCHEDULE_MANAGE');
  const meetings = useMeetings(db, state.classId, true).data ?? [];
  const marks = useNoClass(db, state.classId, true).data ?? [];
  const run = useRun();
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [marking, setMarking] = useState(false);
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const todayKey = manilaDay(Date.now()).dateKey;
  const coming = marks.filter((k) => k.dateKey >= todayKey).sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="bold grow">Timetable</span>
        {manage && (
          <>
            <button type="button" className="btn outline" onClick={() => setMarking(true)}>
              No classes
            </button>
            <button type="button" className="btn outline" onClick={() => setEditing(newMeeting({ courseId: state.courses[0]?.id ?? '' }))}>
              Add meeting
            </button>
          </>
        )}
      </div>
      {meetings.length === 0 && <p className="small muted" style={{ margin: 0 }}>{manage ? (state.courses.length === 0 ? 'Add courses in Class settings first, then add their weekly meetings here.' : 'No meetings yet.') : 'The officers have not added the timetable yet.'}</p>}
      {DAYS.map((day, i) => {
        const list = meetings.filter((m) => m.dayOfWeek === i).sort((a, b) => a.startMinutes - b.startMinutes);
        if (list.length === 0) return null;
        return (
          <div key={day}>
            <div className="small semibold muted">{day}</div>
            {list.map((m) => (
              <div key={m.id} className="row">
                <span className="grow">
                  {clockText(m.startMinutes)} to {clockText(m.endMinutes)} · <span className="semibold">{courseName(m.courseId)}</span>
                  {m.room ? ` · ${m.room}` : ''}
                </span>
                {manage && (
                  <button type="button" className="btn text" onClick={() => setEditing(m)}>
                    Edit
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {coming.length > 0 && <div className="small semibold muted">No classes</div>}
      {coming.map((k) => (
        <div key={k.id} className="row">
          <span className="grow">
            {k.dateKey} · {k.courseId ? courseName(k.courseId) : 'Whole day'}
            {k.reason ? ` · ${k.reason}` : ''}
          </span>
          {manage && (
            <button type="button" className="btn text" onClick={() => run('Classes are back on.', () => removeNoClass(db, state.classId, k.id))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {editing && <MeetingDialog state={state} meeting={editing} onClose={() => setEditing(null)} />}
      {marking && <NoClassDialog state={state} meetings={meetings} onClose={() => setMarking(false)} />}
    </div>
  );
}

function MeetingDialog({ state, meeting, onClose }: { state: ClassState; meeting: Meeting; onClose: () => void }) {
  const run = useRun();
  const [m, setM] = useState(meeting);
  return (
    <Dialog
      title={meeting.id ? 'Edit meeting' : 'Add meeting'}
      onClose={onClose}
      actions={
        <>
          {meeting.id && (
            <button className="btn text danger" style={{ marginRight: 'auto' }} onClick={() => run('Meeting deleted.', () => deleteMeeting(db, state.classId, meeting.id), onClose)}>
              Delete
            </button>
          )}
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" onClick={() => run('Meeting saved.', () => saveMeeting(db, state.classId, m), onClose)}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Course">
          <select value={m.courseId} onChange={(e) => setM({ ...m, courseId: e.target.value })}>
            {state.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day">
          <select value={m.dayOfWeek} onChange={(e) => setM({ ...m, dayOfWeek: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts">
          <input type="time" value={toClock(m.startMinutes)} onChange={(e) => setM({ ...m, startMinutes: fromClock(e.target.value) })} />
        </Field>
        <Field label="Ends">
          <input type="time" value={toClock(m.endMinutes)} onChange={(e) => setM({ ...m, endMinutes: fromClock(e.target.value) })} />
        </Field>
        <Field label="Room (optional)">
          <input value={m.room} maxLength={60} onChange={(e) => setM({ ...m, room: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function NoClassDialog({ state, meetings, onClose }: { state: ClassState; meetings: Meeting[]; onClose: () => void }) {
  const run = useRun();
  const [dateKey, setDateKey] = useState(manilaDay(Date.now()).dateKey);
  const [picked, setPicked] = useState('');
  const [reason, setReason] = useState('');
  // Only the courses that meet on the chosen day can be marked.
  const dayOfWeek = dateKey ? new Date(`${dateKey}T00:00:00Z`).getUTCDay() : -1;
  const meeting = new Set(meetings.filter((m) => m.dayOfWeek === dayOfWeek).map((m) => m.courseId));
  const courses = state.courses.filter((c) => meeting.has(c.id));
  const courseId = meeting.has(picked) ? picked : '';
  return (
    <Dialog
      title="No classes"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" disabled={!dateKey || courses.length === 0} onClick={() => run('Marked as no classes.', () => addNoClass(db, state.myUid, state.classId, dateKey, courseId, reason), onClose)}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Date">
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        </Field>
        <Field label="Which classes">
          <select value={courseId} disabled={courses.length === 0} onChange={(e) => setPicked(e.target.value)}>
            <option value="">The whole day</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {dateKey && courses.length === 0 && <p className="small muted" style={{ margin: 0 }}>The timetable has no classes on that day, so there is nothing to mark.</p>}
        <Field label="Reason (optional)">
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

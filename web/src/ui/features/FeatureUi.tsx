import { useEffect, useMemo, useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import {
  CLAIM_METHODS,
  CLAIM_METHOD_LABELS,
  addComment,
  addNoClasses,
  removeComment,
  setVote,
  tally,
  useComments,
  useVotes,
  type Comment,
  type VoteMarks,
  cancelClaim,
  REMINDER_NOTE_MAX,
  reminderText,
  sendPaymentReminders,
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
  removeNoClasses,
  removeAttendance,
  saveAttendance,
  sheetId,
  useAttendance,
  useAttendanceTotals,
  useMyAttendance,
  type AttendanceMark,
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
  type NoClassMark,
} from '../../data/features';
import { meetingPhase, type MeetingPhase } from '../../domain/meetingPhase';
import { Ledger } from '../../domain/ledger';
import { ROLE_MEMBER, byLastName, listName } from '../../data/models';
import { formatMoney, parsePesos } from '../../domain/money';
import { courseShortName, layoutWeek } from '../../domain/weekGrid';
import { weekImage } from './weekImage';
import { attendanceExportSheets, untakenMeetings } from '../../domain/attendanceExport';
import { groupNoClass } from '../../domain/noClassGroups';
import { xlsxFile } from '../../domain/xlsx';
import { Avatar, ConfirmDialog, CourseDot, Dialog, Field, RoleChip, hexColor, inAndroidApp, saveFile, shortDate, shortDateTime } from '../common';
import { Badge, Button, Card, DayHeader, Icon, ListRow, Money, Notice, Section, StatusBadge, TypeIcon } from '../../design';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { useSearchParams } from 'react-router-dom';
import { useForum, useForumAnswersSince, useForumAuthors } from '../../data/forum';
import { forumUnseen } from '../../domain/forumUnseen';
import { ForumView, TagBadge, TagSelect } from './ForumUi';
import { MoreMenu } from '../MoreMenu';

/** Runs a write and shows the result in the snackbar. */
function useRun() {
  const { actions } = useClass();
  return (success: string, work: () => Promise<unknown>, onDone?: () => void) => {
    work()
      .then(() => (actions.showNotice(success), onDone?.()))
      .catch((e) => actions.showNotice(friendlyMessage(e)));
  };
}

/** "2026-11-16" -> "Mon, Nov 16". */
const niceDate = (dateKey: string) =>
  new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const times = (n: number) => `${n} time${n === 1 ? '' : 's'}`;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------- Payment claims

const CLAIM_STATUS: Record<Claim['status'], string> = { PENDING: 'Waiting', CONFIRMED: 'Confirmed', REJECTED: 'Rejected' };

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
    <Section
      title={`Payment claims${manage && waiting.length > 0 ? ` (${waiting.length} waiting)` : ''}`}
      action={
        <Button data-tour="i-paid" variant="outline" size="small" icon="coins" onClick={() => setAdding(true)}>
          I paid
        </Button>
      }
    >
      {manage && waiting.length > 0 && (
        <Card flush>
          <DayHeader>To decide</DayHeader>
          {waiting.map((c) => (
            <ListRow
              key={c.id}
              leading={<TypeIcon icon="hourglass" tone="warning" />}
              title={c.memberName}
              subtitle={[CLAIM_METHOD_LABELS[c.method], c.reference && `Ref ${c.reference}`, shortDate(c.createdAtMillis), c.note].filter(Boolean).join(' · ')}
              trailing={<Money centavos={c.amountCentavos} sign tone="income" />}
            >
              {repeated(c) && <span className="ch-small ch-text-danger ch-block">Another waiting claim has the same reference number.</span>}
              <span className="ch-row ch-gap-2" style={{ marginTop: 8 }}>
                <Button
                  size="small"
                  icon="check"
                  onClick={() => run(`Payment of ${formatMoney(c.amountCentavos)} from ${c.memberName} confirmed.`, () => confirmClaim(db, state.myUid, state.classId, c))}
                >
                  Confirm
                </Button>
                <Button size="small" variant="outline" danger onClick={() => (setReason(''), setRejecting(c))}>
                  Reject
                </Button>
              </span>
            </ListRow>
          ))}
        </Card>
      )}
      {mine.length > 0 ? (
        <Card flush>
          <DayHeader>Your claims</DayHeader>
          {mine.map((c) => (
            <ListRow
              key={c.id}
              leading={<TypeIcon icon={c.status === 'CONFIRMED' ? 'check' : c.status === 'REJECTED' ? 'x' : 'hourglass'} tone={c.status === 'CONFIRMED' ? 'success' : c.status === 'REJECTED' ? 'danger' : 'warning'} />}
              title={`${CLAIM_METHOD_LABELS[c.method]} · ${shortDate(c.createdAtMillis)}`}
              subtitle={c.status === 'REJECTED' ? `Reason: ${c.rejectReason}` : c.reference ? `Ref ${c.reference}` : undefined}
              trailing={
                <>
                  <Money centavos={c.amountCentavos} />
                  <StatusBadge status={c.status === 'CONFIRMED' ? 'success' : c.status === 'REJECTED' ? 'danger' : 'warning'}>{CLAIM_STATUS[c.status]}</StatusBadge>
                </>
              }
            >
              {c.status === 'PENDING' && (
                <span className="ch-row" style={{ marginTop: 8 }}>
                  <Button size="small" variant="outline" onClick={() => run('Claim cancelled.', () => cancelClaim(db, state.classId, c.id))}>
                    Cancel claim
                  </Button>
                </span>
              )}
            </ListRow>
          ))}
        </Card>
      ) : (
        null
      )}
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
                onClick={() => run('Claim rejected.', () => rejectClaim(db, state.myUid, state.classId, rejecting.id, reason, rejecting.memberId), () => setRejecting(null))}
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
    </Section>
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
              run('Claim sent. It is waiting for the treasurer.', () =>
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

// ---------------------------------------------------------------- Payment reminders

/** For officers with the ledger: who owes the class fund, and a push reminder to each with their own amount. */
export function RemindersCard({ state }: { state: ClassState }) {
  const [open, setOpen] = useState(false);
  if (!state.can('RECORDS_MANAGE')) return null;
  const owing = byLastName(state.members).filter((m) => m.id !== state.myUid && state.balanceOf(m.id) < 0);
  const total = owing.reduce((sum, m) => sum - state.balanceOf(m.id), 0);
  return (
    <Section title="Payment reminders">
      <Card>
        {owing.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            Nobody owes the class fund right now.
          </p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <p style={{ margin: 0 }}>
              <strong>{`${owing.length} ${owing.length === 1 ? 'student owes' : 'students owe'}`}</strong>
              {` ${formatMoney(total)} in all.`}
            </p>
            <div>
              <Button size="small" icon="bell" onClick={() => setOpen(true)}>
                Send reminders
              </Button>
            </div>
          </div>
        )}
      </Card>
      {open && <RemindDialog state={state} owing={owing} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function RemindDialog({ state, owing, onClose }: { state: ClassState; owing: ClassState['members']; onClose: () => void }) {
  const { actions } = useClass();
  const [picked, setPicked] = useState(() => new Set(owing.map((m) => m.id)));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const className = state.room?.name ?? 'Class';
  const chosen = owing.filter((m) => picked.has(m.id));
  const example = chosen[0] ?? owing[0];
  const preview = reminderText(className, -state.balanceOf(example.id), note);
  const allPicked = chosen.length === owing.length;
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const send = async () => {
    setBusy(true);
    try {
      const targets = chosen.map((m) => ({ uid: m.id, name: m.name, owedCentavos: -state.balanceOf(m.id) }));
      await sendPaymentReminders(db, state.myUid, state.classId, className, targets, note);
      actions.showNotice(`Reminders sent to ${chosen.length} ${chosen.length === 1 ? 'student' : 'students'}.`);
      onClose();
    } catch (e) {
      actions.showNotice(friendlyMessage(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Send payment reminders"
      onClose={busy ? () => undefined : onClose}
      actions={
        <>
          <button className="btn text" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" disabled={busy || chosen.length === 0} onClick={send}>
            {busy ? 'Sending…' : `Send to ${chosen.length}`}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Students with notifications off will not get it.
      </p>
      <label className="list-row" style={{ cursor: 'pointer', paddingLeft: 0 }}>
        <input type="checkbox" className="check" checked={allPicked} onChange={(e) => setPicked(new Set(e.target.checked ? owing.map((m) => m.id) : []))} />
        <span className="grow semibold">{`Everyone who owes (${owing.length})`}</span>
      </label>
      <div style={{ maxHeight: 260, overflowY: 'auto', margin: '0 -4px' }}>
        {owing.map((m) => (
          <label key={m.id} className="list-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" className="check" checked={picked.has(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />
            <Avatar photo={state.avatars.get(m.id)} name={m.name} color="var(--accent, #0F766E)" size={30} />
            <span className="grow">
              <span style={{ display: 'block' }}>{m.name}</span>
              <span className="small" style={{ color: 'var(--error)', fontWeight: 600 }}>
                {`Owes ${formatMoney(-state.balanceOf(m.id))}`}
              </span>
            </span>
          </label>
        ))}
      </div>
      <Field label="Note (optional)" help="Added after the amount, for example where and when to pay.">
        <input value={note} maxLength={REMINDER_NOTE_MAX} placeholder="Pay the Treasurer by Friday." onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="small muted" style={{ margin: '12px 0 4px' }}>
        {`What ${example.name.split(' ')[0]} will see`}
      </div>
      <div style={{ border: '1px solid var(--outline)', borderRadius: 12, padding: '10px 12px', background: 'var(--surface)' }}>
        <div className="semibold">{preview.title}</div>
        <div className="small">{preview.body}</div>
      </div>
    </Dialog>
  );
}

/** Under a cancelled meeting's time and room, so a long reason wraps instead of squeezing the course name. */
function CancelledNote({ reason }: { reason: string }) {
  return (
    <span className="cancel-note">
      <StatusBadge status="danger">{`No classes${reason ? `: ${reason}` : ''}`}</StatusBadge>
    </span>
  );
}

// ---------------------------------------------------------------- Statement and export

/** A CSV with a byte order mark, so Excel reads the peso sign and accents right. */
const csvBlob = (text: string) => new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });

const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const pesos = (centavos: number) => (centavos / 100).toFixed(2);

const STATEMENT_ICON = {
  PAYMENT: { icon: 'income', tone: 'income', label: 'Payment' },
  CHARGE: { icon: 'charge', tone: 'charge', label: 'Charge' },
  WITHDRAWAL: { icon: 'withdrawal', tone: 'withdrawal', label: 'Withdrawal' },
  EXPENSE: { icon: 'payout', tone: 'payout', label: 'Pay out from fund' },
  OPENING: { icon: 'flag', tone: 'opening', label: 'Opening balance' },
} as const;

/** In the Ledger tab: a student's statement with a running balance, and the CSV export for those who see every record. */
export function StatementCard({ state }: { state: ClassState }) {
  const [open, setOpen] = useState(false);
  const { actions } = useClass();
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
    const balances = byLastName(state.members).map((m) => [listName(m), pesos(state.balanceOf(m.id))].map(cell).join(','));
    const csv = csvBlob([head, ...rows, '', [cell('Student'), cell('Balance')].join(','), ...balances].join('\r\n'));
    saveFile(`${state.room?.name ?? 'class'} ledger.csv`, csv, actions.showNotice).catch((e) => actions.showNotice(friendlyMessage(e)));
  }

  const balance = lines.length > 0 ? lines[lines.length - 1].balance : 0;
  return (
    <div className="ch-row ch-wrap ch-gap-2">
      <Button variant="outline" icon="file" onClick={() => setOpen(true)}>
        My statement
      </Button>
      {state.seeAll && (
        <Button variant="outline" icon="download" onClick={exportCsv}>
          Export CSV
        </Button>
      )}
      {open && (
        <Dialog
          title={`Statement of ${state.me?.name ?? ''}`}
          onClose={() => setOpen(false)}
          actions={
            <>
              {!inAndroidApp() && (
                <button className="btn text" onClick={() => window.print()}>
                  Print
                </button>
              )}
              <button className="btn text" onClick={() => setOpen(false)}>
                Close
              </button>
            </>
          }
        >
          {lines.length === 0 ? (
            <Notice tone="info">No records yet.</Notice>
          ) : (
            <Card flush>
              {lines.map(({ r, change, balance }) => (
                <ListRow
                  key={r.id}
                  leading={<TypeIcon icon={STATEMENT_ICON[r.type].icon} tone={STATEMENT_ICON[r.type].tone} size={32} />}
                  title={r.note || STATEMENT_ICON[r.type].label}
                  subtitle={`${shortDate(r.dateMillis)} · Balance after: ${formatMoney(balance)}`}
                  trailing={<Money centavos={change} sign tone={change >= 0 ? 'income' : 'charge'} />}
                />
              ))}
              <ListRow title="Balance now" trailing={<Money centavos={balance} size="mid" />} />
            </Card>
          )}
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Announcements

export function NewsTab({ state }: { state: ClassState }) {
  const manage = state.can('ANNOUNCEMENTS_MANAGE');
  const allPosts = useAnnouncements(db, state.classId, true).data;
  // ?forum=all opens the Forum, ?forum=<id> one question (links from notifications use these).
  const [params, setParams] = useSearchParams();
  const forumParam = params.get('forum');
  const inForum = forumParam !== null;
  const openForum = (id: string) => setParams({ tab: 'NEWS', forum: id || 'all' }, { replace: !id });
  const showAnnouncements = () => setParams({ tab: 'NEWS' }, { replace: true });
  const questions = useForum(db, state.classId, manage, true).data;
  const authors = useForumAuthors(db, state.classId, state.myUid, manage, true).data ?? [];
  const [tag, setTag] = useState('*');
  const posts = allPosts?.filter((p) => tag === '*' || p.courseId === tag);
  const seen = useSeen(db, state.classId, true).data ?? [];
  const votes = useVotes(db, state.classId, true).data ?? [];
  const memberIds = useMemo(() => new Set(state.members.map((m) => m.id)), [state.members]);
  const run = useRun();
  const [openId, setOpenId] = useState('');
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [seenOf, setSeenOf] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const mine = seen.find((s) => s.id === state.myUid);
  const mySeen = mine?.announcements ?? {};
  const unseen = inForum ? '' : (allPosts ?? []).filter((p) => !mySeen[p.id]).map((p) => p.id).join(',');
  const unseenPosts = (allPosts ?? []).filter((p) => !mySeen[p.id] && p.createdByUid !== state.myUid).length;
  // What is new in the Forum since this member last opened it: questions, and answers or replies to them.
  const myPostIds = new Set(authors.filter((a) => a.uid === state.myUid).map((a) => a.id));
  const forumAt = mine?.forumAt ?? 0;
  const answersSince = useForumAnswersSince(db, state.classId, forumAt, !!mine && !inForum).data ?? [];
  const newQuestions = forumUnseen(questions ?? [], answersSince, state.myUid, myPostIds, forumAt).total;

  // Showing the list counts as opening the posts.
  useEffect(() => {
    if (unseen) markSeen(db, state.classId, state.myUid, unseen.split(',')).catch(() => {});
  }, [unseen, state.classId, state.myUid]);

  const switcher = (
    <div className="ch-segmented ch-full news-switch" role="group" aria-label="News">
      <button type="button" className={inForum ? '' : 'ch-selected'} aria-pressed={!inForum} onClick={showAnnouncements}>
        Announcements
        {inForum && unseenPosts > 0 && <span className="news-count">{unseenPosts}</span>}
      </button>
      <button type="button" className={inForum ? 'ch-selected' : ''} aria-pressed={inForum} onClick={() => openForum('')}>
        Forum
        {!inForum && newQuestions > 0 && <span className="news-count">{newQuestions}</span>}
      </button>
    </div>
  );

  if (inForum) {
    return (
      <div className="stack">
        {switcher}
        <ForumView
          state={state}
          questions={questions}
          authors={authors}
          seen={seen}
          lastVisit={forumAt}
          openId={forumParam === 'all' ? '' : (forumParam ?? '')}
          onOpen={openForum}
          onPromote={(post) => {
            showAnnouncements();
            setEditing(post);
          }}
        />
      </div>
    );
  }

  const seenBy = (id: string) => seen.filter((s) => s.announcements[id] && state.members.some((m) => m.id === s.id)).length;

  return (
    <div className="stack">
      {switcher}
      {manage && (
        <div className="ch-row">
          <Button icon="bell" onClick={() => setEditing(newAnnouncement({}))}>
            New announcement
          </Button>
        </div>
      )}
      {(allPosts ?? []).length > 0 && state.courses.length > 0 && (
        <div className="forum-search">
          <TagSelect state={state} value={tag} onChange={setTag} label="Tag" all />
        </div>
      )}
      {posts && posts.length === 0 && <Notice tone="info">{tag === '*' ? 'No announcements yet.' : 'No announcements with this tag.'}</Notice>}
      {(posts ?? []).map((p) => (
        <Card key={p.id}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="card-head">
              <div className="stack" style={{ gap: 8 }}>
                {(p.pinned || p.courseId) && (
                  <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
                    {p.pinned && (
                      <Badge tone="primary" icon="pin">
                        Pinned
                      </Badge>
                    )}
                    <TagBadge state={state} courseId={p.courseId} />
                  </div>
                )}
                <Byline state={state} uid={p.createdByUid} fallback="A former member" when={p.createdAtMillis} edited={!!p.editedAtMillis} size={40} />
              </div>
              <MoreMenu
                label={`More for "${p.title}"`}
                title={p.title}
                items={[
                  manage && { label: 'Edit', icon: 'edit', onClick: () => setEditing(p) },
                  manage && { label: p.pinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: () => run(p.pinned ? 'Unpinned.' : 'Pinned.', () => saveAnnouncement(db, state.myUid, state.classId, { ...p, pinned: !p.pinned })) },
                  manage && { label: 'Delete', icon: 'trash', danger: true, onClick: () => setDeleting(p) },
                ]}
              />
            </div>
            <div className="bold" style={{ fontSize: 18, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {p.title}
            </div>
            {p.body && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{p.body}</div>}
            <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
              <VoteBar state={state} votes={votes} memberIds={memberIds} targetId={p.id} />
              {(!p.commentsOff || p.commentCount > 0) && (
                <Button size="small" variant={openId === p.id ? 'solid' : 'outline'} icon="comment" aria-expanded={openId === p.id} onClick={() => setOpenId(openId === p.id ? '' : p.id)}>
                  {p.commentCount === 0 ? 'Comment' : `${p.commentCount} comment${p.commentCount === 1 ? '' : 's'}`}
                </Button>
              )}
              <button type="button" className="seen-link" onClick={() => setSeenOf(p)}>
                <Icon name="eye" size={16} />
                <span>
                  <span className="seen-word">Seen by </span>
                  {`${seenBy(p.id)} of ${state.members.length}`}
                </span>
              </button>
            </div>
            {openId === p.id && <Thread state={state} post={p} votes={votes} memberIds={memberIds} />}
          </div>
        </Card>
      ))}
      {editing && <PostDialog state={state} post={editing} onClose={() => setEditing(null)} />}
      {seenOf && (
        <Dialog
          title="Seen by"
          onClose={() => setSeenOf(null)}
          actions={
            <button className="btn text" onClick={() => setSeenOf(null)}>
              Close
            </button>
          }
        >
          <p className="small muted" style={{ marginTop: 0 }}>{seenOf.title}</p>
          {[true, false].map((did) => {
            const list = byLastName(state.members).filter((m) => !!seen.find((x) => x.id === m.id)?.announcements[seenOf.id] === did);
            return (
              list.length > 0 && (
                <Card flush key={String(did)}>
                  <DayHeader>{did ? `Seen (${list.length})` : `Not yet (${list.length})`}</DayHeader>
                  {list.map((m) => (
                    <ListRow key={m.id} title={listName(m)} />
                  ))}
                </Card>
              )
            );
          })}
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          text="The announcement and its comments will be removed for everyone in the class."
          confirm="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => run('Announcement deleted.', () => deleteAnnouncement(db, state.myUid, state.classId, deleting.id))}
        />
      )}
    </div>
  );
}

/**
 * Who wrote something: their photo (or initials in their role colour), name, role when it is not the
 * plain member role, and the date.
 */
function Byline({ state, uid, fallback, when, edited, size }: { state: ClassState; uid: string; fallback: string; when: number; edited?: boolean; size: number }) {
  const member = state.members.find((m) => m.id === uid);
  const role = member ? state.roles.find((r) => r.id === member.roleId) : undefined;
  const name = member?.name ?? fallback;
  // Everyone but the plain members: a role with its own name shows even when it has no permissions.
  const titled = !!role && role.id !== (state.room?.defaultRoleId || ROLE_MEMBER);
  return (
    <div className="byline">
      <Avatar photo={state.avatars.get(uid)} name={name} color={hexColor(role?.colorHex, '#6B768A')} size={size} />
      <div className="byline-text">
        <span className="bold comment-name">{name}</span>
        {titled && role && <RoleChip name={role.name} color={role.colorHex} />}
        <span className="ch-small ch-muted">
          {shortDateTime(when)}
          {edited ? ' · edited' : ''}
        </span>
      </div>
    </div>
  );
}

/** Up and down buttons with their counts. Tapping your own choice again takes the vote back. */
function VoteBar({ state, votes, memberIds, targetId }: { state: ClassState; votes: VoteMarks[]; memberIds: Set<string>; targetId: string }) {
  const { actions } = useClass();
  const t = tally(votes, targetId, memberIds, state.myUid);
  const cast = (value: 1 | -1) =>
    setVote(db, state.classId, state.myUid, targetId, t.mine === value ? 0 : value).catch((e) => actions.showNotice(friendlyMessage(e)));
  return (
    <div className="vote-bar" role="group" aria-label="Votes">
      <button type="button" className={`vote${t.mine === 1 ? ' on' : ''}`} aria-pressed={t.mine === 1} aria-label={`Upvote, ${t.up} so far`} onClick={() => cast(1)}>
        <Icon name="up" size={16} />
        {t.up}
      </button>
      <button type="button" className={`vote${t.mine === -1 ? ' on' : ''}`} aria-pressed={t.mine === -1} aria-label={`Downvote, ${t.down} so far`} onClick={() => cast(-1)}>
        <Icon name="down" size={16} />
        {t.down}
      </button>
    </div>
  );
}

/** The comments under one announcement: comments by score, replies under each in the order they came. */
function Thread({ state, post, votes, memberIds }: { state: ClassState; post: Announcement; votes: VoteMarks[]; memberIds: Set<string> }) {
  const run = useRun();
  const comments = useComments(db, state.classId, post.id).data;
  const manage = state.can('ANNOUNCEMENTS_MANAGE');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ top: Comment; to: Comment } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [removing, setRemoving] = useState<Comment | null>(null);
  const me ={ uid: state.myUid, name: state.members.find((m) => m.id === state.myUid)?.name ?? '' };
  const nameOf = (c: Comment) => state.members.find((m) => m.id === c.uid)?.name ?? c.name;
  const score = (c: Comment) => {
    const t = tally(votes, c.id, memberIds, state.myUid);
    return t.up - t.down;
  };
  const tops = (comments ?? []).filter((c) => !c.parentId).sort((a, b) => score(b) - score(a) || a.createdAtMillis - b.createdAtMillis);

  const line = (c: Comment, top: Comment) => (
    <div className="comment" key={c.id}>
      <div className="card-head">
        <Byline state={state} uid={c.uid} fallback={c.name} when={c.createdAtMillis} size={28} />
        {!c.removedAtMillis && (
          <MoreMenu
            label={`More for ${nameOf(c)}'s comment`}
            title={c.text}
            items={[(c.uid === state.myUid || manage) && { label: 'Remove', icon: 'trash', danger: true, onClick: () => setRemoving(c) }]}
          />
        )}
      </div>
      {c.removedAtMillis ? (
        <div className="ch-muted" style={{ fontStyle: 'italic' }}>Comment removed</div>
      ) : (
        <>
          <div className="comment-text">{c.text}</div>
          <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
            <VoteBar state={state} votes={votes} memberIds={memberIds} targetId={c.id} />
            {!post.commentsOff && (
              <button
                type="button"
                className="btn text"
                onClick={() => {
                  setReplyTo({ top, to: c });
                  setReplyText(c.id === top.id ? '' : `@${nameOf(c)} `);
                }}
              >
                Reply
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="thread">
      {post.commentsOff ? (
        <Notice tone="info">Comments are turned off for this announcement.</Notice>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <Field label="Write a comment">
            <textarea value={text} rows={2} maxLength={500} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="ch-row">
            <Button size="small" disabled={!text.trim()} onClick={() => run('Comment posted.', () => addComment(db, me, state.classId, post, '', text, post.createdByUid), () => setText(''))}>
              Post comment
            </Button>
          </div>
        </div>
      )}
      {comments && comments.length === 0 && !post.commentsOff && <div className="ch-small ch-muted">No comments yet.</div>}
      {tops.map((top) => {
        const replies = (comments ?? []).filter((c) => c.parentId === top.id);
        const shown = expanded[top.id] ? replies : replies.slice(0, 3);
        const hidden = replies.length - shown.length;
        const replying = replyTo?.top.id === top.id ? replyTo : null;
        return (
          <div className="comment-group" key={top.id}>
            {line(top, top)}
            {(replies.length > 0 || replying) && (
              <div className="replies">
                {shown.map((r) => line(r, top))}
                {hidden > 0 && (
                  <button type="button" className="btn text" onClick={() => setExpanded({ ...expanded, [top.id]: true })}>
                    {`Show ${hidden} more ${hidden === 1 ? 'reply' : 'replies'}`}
                  </button>
                )}
                {replying && (
                  <div className="stack" style={{ gap: 8 }}>
                    <Field label={`Reply to ${nameOf(replying.to)}`}>
                      <textarea autoFocus value={replyText} rows={2} maxLength={500} onChange={(e) => setReplyText(e.target.value)} />
                    </Field>
                    <div className="ch-row ch-gap-2">
                      <Button
                        size="small"
                        disabled={!replyText.trim()}
                        onClick={() =>
                          run('Reply posted.', () => addComment(db, me, state.classId, post, top.id, replyText, replying.to.uid), () => {
                            setReplyTo(null);
                            setExpanded({ ...expanded, [top.id]: true });
                          })
                        }
                      >
                        Post reply
                      </Button>
                      <Button size="small" variant="text" onClick={() => setReplyTo(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {removing && (
        <ConfirmDialog
          title="Remove this comment?"
          text="It will be removed for everyone in the class."
          confirm="Remove"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            run('Comment removed.', () =>
              removeComment(
                db, state.classId, removing.id,
                // Only an officer removing someone else's comment goes in the History log.
                removing.uid !== state.myUid
                  ? { actorUid: state.myUid, kind: 'COMMENT_REMOVED', text: `Removed a comment by ${nameOf(removing)} on "${post.title}": "${snippet(removing.text)}"` }
                  : undefined,
              ),
            )
          }
        />
      )}
    </div>
  );
}

function PostDialog({ state, post, onClose }: { state: ClassState; post: Announcement; onClose: () => void }) {
  const run = useRun();
  const [comments, setComments] = useState(!post.commentsOff);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [pinned, setPinned] = useState(post.pinned);
  const [courseId, setCourseId] = useState(post.courseId);
  const course = state.courses.find((c) => c.id === courseId);
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
            onClick={() => run(post.id ? 'Announcement saved.' : 'Announcement posted.', () => saveAnnouncement(db, state.myUid, state.classId, { ...post, title, body, pinned, commentsOff: !comments, courseId }), onClose)}
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
        {state.courses.length > 0 && (
          <Field label="Tag" help={post.id ? undefined : course ? `Only students taking ${course.name} get a notification.` : 'The whole class gets a notification.'}>
            <TagSelect state={state} value={courseId} onChange={setCourseId} label="Tag" />
          </Field>
        )}
        <label className="row">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top
        </label>
        <label className="row">
          <input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} /> Allow comments
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

/** The start time as a small tile in front of a meeting row ("8:00" over "AM"), in place of a repeated icon. */
function TimeTile({ minutes, cancelled, ended, color }: { minutes: number; cancelled?: boolean; ended?: boolean; color?: string }) {
  const [clock, half] = clockText(minutes).split(' ');
  // Cancelled: red and crossed out. Over for today: grey, so it stands apart from a cancelled class.
  const toned = cancelled || ended;
  return (
    <span
      aria-hidden
      className={cancelled ? 'ch-tone-danger' : ended ? 'ch-tone-neutral' : 'ch-tone-primary'}
      style={{
        flex: 'none', width: 52, height: 44, borderRadius: 12, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: toned ? 'var(--tb)' : color || 'var(--ch-primary)', color: toned ? 'var(--tc)' : color ? '#fff' : 'var(--ch-on-primary)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', textDecoration: cancelled ? 'line-through' : undefined,
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 15 }}>{clock}</span>
      <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>{half}</span>
    </span>
  );
}

/** The time now, refreshed every 30 seconds, so a class turns "Now" and then "Ended" on its own. */
function useClockTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** How a meeting row shows where the class stands today (a cancelled one shows its "No classes" note instead). */
function phaseLook(phase: MeetingPhase, cancelled: boolean) {
  const ended = !cancelled && phase === 'ENDED';
  return {
    ended,
    struck: cancelled || ended,
    suffix: ended ? ' · Ended' : '',
    trailing: !cancelled && phase === 'NOW' ? <Badge tone="success">Now</Badge> : undefined,
  };
}

/** The timetable without the meetings of a course that has since been deleted. */
function useLiveMeetings(state: ClassState): Meeting[] {
  const all = useMeetings(db, state.classId, true).data;
  return useMemo(() => (all ?? []).filter((m) => state.courses.some((c) => c.id === m.courseId)), [all, state.courses]);
}

/** Today and tomorrow, for Home. Shows nothing when the class has no timetable. */
export function TodayCard({ state }: { state: ClassState }) {
  const meetings = useLiveMeetings(state);
  const marks = useNoClass(db, state.classId, true).data ?? [];
  const now = useClockTick();
  if (meetings.length === 0) return null;
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const courseColor = (id: string) => state.courses.find((c) => c.id === id)?.color || undefined;
  const mine = (m: Meeting) => state.takes(m.courseId);
  const days: [string, number][] = [
    ['Today', now],
    ['Tomorrow', now + 86_400_000],
  ];
  return (
    <Section title="Classes">
      <Card flush>
        {days.map(([label, at]) => {
          const list = meetingsOn(meetings, marks, at).filter((x) => mine(x.meeting));
          return (
            <div key={label}>
              <DayHeader>{label}</DayHeader>
              {list.length === 0 && <ListRow leading={<TypeIcon icon="moon" tone="neutral" />} title="No classes" />}
              {list.map(({ meeting: m, cancelled }) => {
                const look = phaseLook(meetingPhase(m.startMinutes, m.endMinutes, at, now), !!cancelled);
                return (
                  <ListRow
                    key={m.id}
                    voided={look.struck}
                    leading={<TimeTile minutes={m.startMinutes} cancelled={!!cancelled} ended={look.ended} color={courseColor(m.courseId)} />}
                    title={courseName(m.courseId)}
                    subtitle={`${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}${m.room ? ` · ${m.room}` : ''}${m.instructor ? ` · ${m.instructor}` : ''}${look.suffix}`}
                    trailing={look.trailing}
                    children={cancelled ? <CancelledNote reason={cancelled.reason} /> : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

// Tall enough for a one-hour block to show its four lines: course, time, room and instructor.
const HOUR_PX = 64;
const DAY_MS = 86_400_000;

/** The mark that cancels this meeting the next time it happens (today counts), if any. */
function nextCancelled(meeting: Meeting, meetings: Meeting[], marks: NoClassMark[], now: number): NoClassMark | null {
  const ahead = (meeting.dayOfWeek - manilaDay(now).dayOfWeek + 7) % 7;
  return meetingsOn(meetings, marks, now + ahead * DAY_MS).find((x) => x.meeting.id === meeting.id)?.cancelled ?? null;
}

/** The whole week as a grid: a column per day that has meetings, time down the side, a block per meeting in its course colour. */
function WeekGrid({ state, meetings, marks, onOpen }: { state: ClassState; meetings: Meeting[]; marks: NoClassMark[]; onOpen: (m: Meeting) => void }) {
  const week = useMemo(() => layoutWeek(meetings), [meetings]);
  const now = Date.now();
  const today = manilaDay(now).dayOfWeek;
  const course = (id: string) => state.courses.find((c) => c.id === id);
  const hours: number[] = [];
  for (let t = week.fromMinutes; t <= week.toMinutes; t += 60) hours.push(t);
  const height = ((week.toMinutes - week.fromMinutes) / 60) * HOUR_PX;
  const hourLabel = (minutes: number) => clockText(minutes).replace(':00', '');
  return (
    <div className="ch-week">
      <div className="ch-week-grid" style={{ gridTemplateColumns: `34px repeat(${week.days.length}, minmax(50px, 1fr))` }}>
        <span />
        {week.days.map((d) => (
          <span key={d} className={'ch-week-head' + (d === today ? ' today' : '')}>
            {DAYS[d].slice(0, 3)}
          </span>
        ))}
        <div className="ch-week-times" style={{ height }} aria-hidden>
          {hours.map((t) => (
            <span key={t} className="ch-week-time" style={{ top: ((t - week.fromMinutes) / 60) * HOUR_PX }}>
              {hourLabel(t)}
            </span>
          ))}
        </div>
        {week.days.map((d) => (
          <div key={d} className={'ch-week-col' + (d === today ? ' today' : '')} style={{ height, backgroundSize: `100% ${HOUR_PX}px` }} role="group" aria-label={DAYS[d]}>
            {week.byDay[d].map((b) => {
              const m = b.item;
              const name = course(m.courseId)?.name ?? 'Course';
              const cancelled = nextCancelled(m, meetings, marks, now);
              const other = !state.takes(m.courseId);
              // A long course name wraps over the lines left after the time, room and instructor, so those are never pushed out.
              const blockHeight = ((b.endMinutes - b.startMinutes) / 60) * HOUR_PX - 2;
              const nameLines = Math.max(1, Math.floor((blockHeight - 6 - (1 + (m.room ? 1 : 0) + (m.instructor ? 1 : 0)) * 13.5) / 14.5));
              const label = [
                `${name}, ${DAYS[d]} ${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}`,
                m.room,
                m.instructor,
                other ? 'Not your course' : '',
                cancelled ? `No classes on ${niceDate(cancelled.dateKey)}${cancelled.reason ? `: ${cancelled.reason}` : ''}` : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <button
                  key={m.id}
                  type="button"
                  className={'ch-week-block' + (cancelled ? ' cancelled' : '') + (other ? ' other' : '')}
                  title={label}
                  aria-label={label}
                  onClick={() => onOpen(m)}
                  style={{
                    top: ((b.startMinutes - week.fromMinutes) / 60) * HOUR_PX + 1,
                    height: blockHeight,
                    left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / b.lanes}% - 4px)`,
                    background: course(m.courseId)?.color || 'var(--ch-primary)',
                  }}
                >
                  <span className="ch-week-name" style={{ WebkitLineClamp: nameLines }}>
                    <span className="full">{name}</span>
                    <span className="short">{courseShortName(name)}</span>
                  </span>
                  <span className="ch-week-sub">
                    <span className="full">{`${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}`}</span>
                    <span className="short">
                      {clockText(m.startMinutes).split(' ')[0]}–
                      <br />
                      {clockText(m.endMinutes).split(' ')[0]}
                    </span>
                  </span>
                  {m.room && <span className="ch-week-sub">{m.room}</span>}
                  {m.instructor && <span className="ch-week-sub full">{m.instructor}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The weekly timetable, in the Schedule tab. Officers with the schedule permission edit it and mark "no classes". */
export function TimetableCard({ state }: { state: ClassState }) {
  const manage = state.can('SCHEDULE_MANAGE');
  const everyMeeting = useLiveMeetings(state);
  // Students see only the meetings of courses they take. Officers who run the timetable or attendance see all.
  const seesAll = manage || state.can('ATTENDANCE_MANAGE');
  const meetings = seesAll ? everyMeeting : everyMeeting.filter((m) => state.takes(m.courseId));
  const notMine = (m: Meeting) => (state.takes(m.courseId) ? '' : ' · Not your course');
  const marks = useNoClass(db, state.classId, true).data ?? [];
  const run = useRun();
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [marking, setMarking] = useState(false);
  const [taking, setTaking] = useState(false);
  const [fullWeek, setFullWeek] = useState(false);
  const [moreDays, setMoreDays] = useState(false);
  const [viewing, setViewing] = useState<Meeting | null>(null);
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const courseColor = (id: string) => state.courses.find((c) => c.id === id)?.color || undefined;
  const now = useClockTick();
  const todayKey = manilaDay(now).dateKey;
  // Officers who take attendance see on today's meetings whether it was taken.
  const attends = state.can('ATTENDANCE_MANAGE');
  const sheets = useAttendance(db, state.classId, attends).data;
  const attendanceBadge = (m: Meeting, phase: MeetingPhase, isToday: boolean, cancelled: boolean) => {
    if (!attends || !isToday || cancelled || !sheets) return null;
    if (sheets.some((x) => x.id === sheetId(todayKey, m.id))) return <Badge tone="success" icon="check">Attendance taken</Badge>;
    return phase === 'LATER' ? null : <Badge tone="neutral">Attendance not taken</Badge>;
  };
  // Folded, the card shows only today and tomorrow, so the deadlines below stay within reach.
  // "Show more" lists the next seven days, each with its date.
  const soon: [string, number][] = Array.from({ length: moreDays ? 7 : 2 }, (_, i) => {
    const millis = now + i * DAY_MS;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : null;
    return [label ? `${label} · ${DAYS[manilaDay(millis).dayOfWeek]}` : niceDate(manilaDay(millis).dateKey), millis];
  });
  const coming = marks.filter((k) => k.dateKey >= todayKey).sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  // Marks saved together (a suspension over several days) show as one entry.
  const comingGroups = groupNoClass(coming, (day) => meetings.some((m) => m.dayOfWeek === weekdayOf(day)));
  const [removing, setRemoving] = useState<NoClassMark[] | null>(null);
  const viewingCancelled = viewing ? nextCancelled(viewing, meetings, marks, now) : null;
  const { actions } = useClass();
  const [saving, setSaving] = useState(false);
  // Anyone can save the full week as a picture, with the meetings they see.
  const saveImage = async () => {
    setSaving(true);
    try {
      const className = state.room?.name ?? 'Class';
      const blob = await weekImage({
        title: className,
        subtitle: meetings.length === everyMeeting.length ? 'Weekly timetable' : 'Weekly timetable · My courses',
        meetings,
        course: (id) => state.courses.find((c) => c.id === id),
      });
      await saveFile(`${className} timetable.png`, blob, actions.showNotice);
    } catch (e) {
      actions.showNotice(friendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Timetable">
      {(manage || state.can('ATTENDANCE_MANAGE')) && (
        <div className="ch-row ch-wrap ch-gap-2">
          {state.can('ATTENDANCE_MANAGE') && meetings.length > 0 && (
            <Button size="small" icon="check" onClick={() => setTaking(true)}>
              Take attendance
            </Button>
          )}
          {manage && (
            <Button size="small" variant="outline" icon="plus" disabled={state.courses.length === 0} onClick={() => setEditing(newMeeting({ courseId: state.courses[0]?.id ?? '' }))}>
              Add meeting
            </Button>
          )}
          {manage && meetings.length > 0 && (
            <Button size="small" variant="outline" icon="ban" onClick={() => setMarking(true)}>
              No classes
            </Button>
          )}
        </div>
      )}
      {meetings.length === 0 ? (
        <Notice tone="info">
          {manage
            ? state.courses.length === 0
              ? 'Add courses first (Home, Manage, Courses), then add their weekly meetings here.'
              : 'No meetings yet. Add the weekly class meetings of each course.'
            : 'The officers have not added the timetable yet.'}
        </Notice>
      ) : (
        <Card flush>
          {!fullWeek &&
            soon.map(([label, millis]) => {
              const list = meetingsOn(meetings, marks, millis);
              return (
                <div key={label}>
                  <DayHeader>{label}</DayHeader>
                  {list.length === 0 && <ListRow leading={<TypeIcon icon="moon" tone="neutral" />} title="No classes" />}
                  {list.map(({ meeting: m, cancelled }) => {
                    const phase = meetingPhase(m.startMinutes, m.endMinutes, millis, now);
                    const look = phaseLook(phase, !!cancelled);
                    const taken = attendanceBadge(m, phase, manilaDay(millis).dateKey === todayKey, !!cancelled);
                    return (
                      <ListRow
                        key={m.id}
                        voided={look.struck}
                        leading={<TimeTile minutes={m.startMinutes} cancelled={!!cancelled} ended={look.ended} color={courseColor(m.courseId)} />}
                        title={courseName(m.courseId)}
                        subtitle={`${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}${m.room ? ` · ${m.room}` : ''}${m.instructor ? ` · ${m.instructor}` : ''}${notMine(m)}${look.suffix}`}
                        trailing={look.trailing}
                        // Under the time and room, not beside them, so a long course name keeps its width on a phone.
                        children={cancelled ? <CancelledNote reason={cancelled.reason} /> : taken ? <span className="att-row-badge">{taken}</span> : undefined}
                        chevron={manage}
                        onClick={manage ? () => setEditing(m) : undefined}
                      />
                    );
                  })}
                </div>
              );
            })}
          {fullWeek && <WeekGrid state={state} meetings={meetings} marks={marks} onOpen={manage ? setEditing : setViewing} />}
          <div className="ch-row ch-wrap" style={{ padding: '4px 12px 0' }}>
            {!fullWeek && (
              <Button size="small" variant="text" icon={moreDays ? 'up' : 'down'} onClick={() => setMoreDays(!moreDays)}>
                {moreDays ? 'Show less' : 'Show more'}
              </Button>
            )}
            <Button size="small" variant="text" icon={fullWeek ? 'x' : 'list'} onClick={() => (setFullWeek(!fullWeek), setMoreDays(false))}>
              {fullWeek ? 'Show today and tomorrow only' : 'Full week'}
            </Button>
            {fullWeek && (
              <Button size="small" variant="text" icon="download" disabled={saving} onClick={saveImage}>
                Save as image
              </Button>
            )}
          </div>
        </Card>
      )}
      {comingGroups.length > 0 && (
        <Card flush>
          <DayHeader>No classes</DayHeader>
          {comingGroups.map((group) => {
            const dates = [...new Set(group.map((k) => k.dateKey))];
            const affected = group.flatMap((k) => meetings.filter((m) => m.dayOfWeek === weekdayOf(k.dateKey) && (!k.courseId || k.courseId === m.courseId)));
            const which = group.every((k) => !k.courseId) ? 'Whole day' : [...new Set(affected.map((m) => courseName(m.courseId)))].join(', ');
            return (
              <ListRow
                key={group[0].id}
                leading={<TypeIcon icon="ban" tone="danger" />}
                title={dates.length === 1 ? niceDate(dates[0]) : `${niceDate(dates[0])} to ${niceDate(dates[dates.length - 1])}`}
                subtitle={`${affected.length} class${affected.length === 1 ? '' : 'es'}${which ? ` · ${which}` : ''}`}
                children={group[0].reason ? <span className="att-row-badge"><Badge tone="neutral">{group[0].reason}</Badge></span> : undefined}
                actions={
                  manage ? (
                    <Button size="small" variant="text" onClick={() => setRemoving(group)}>
                      Remove
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </Card>
      )}
      {removing && (
        <ConfirmDialog
          title="Classes are back on?"
          text={`${(() => {
            const dates = [...new Set(removing.map((k) => k.dateKey))];
            return dates.length === 1 ? niceDate(dates[0]) : `${niceDate(dates[0])} to ${niceDate(dates[dates.length - 1])}`;
          })()} will show the classes again in everyone's timetable. No notification is sent.`}
          confirm="Remove"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            run(
              'Classes are back on.',
              () =>
                removeNoClasses(db, state.classId, removing.map((k) => k.id), {
                  actorUid: state.myUid, kind: 'NO_CLASS_REMOVED', text: `Classes are back on: ${noClassText(removing, courseName)}`,
                }),
              () => setRemoving(null),
            )
          }
        />
      )}
      {taking && <AttendanceDialog state={state} meetings={meetings} onClose={() => setTaking(false)} />}
      {editing && <MeetingDialog state={state} meeting={editing} meetings={everyMeeting} onClose={() => setEditing(null)} />}
      {viewing && (
        <Dialog title={courseName(viewing.courseId)} onClose={() => setViewing(null)} actions={<button className="btn text" onClick={() => setViewing(null)}>Close</button>}>
          <p>{`${DAYS[viewing.dayOfWeek]}, ${clockText(viewing.startMinutes)} to ${clockText(viewing.endMinutes)}`}</p>
          {viewing.room && <p>{viewing.room}</p>}
          {viewing.instructor && <p>{viewing.instructor}</p>}
          {viewingCancelled && <p className="ch-muted">{`No classes on ${niceDate(viewingCancelled.dateKey)}${viewingCancelled.reason ? `: ${viewingCancelled.reason}` : ''}`}</p>}
        </Dialog>
      )}
      {marking && <NoClassDialog state={state} meetings={meetings} onClose={() => setMarking(false)} />}
    </Section>
  );
}

function MeetingDialog({ state, meeting, meetings, onClose }: { state: ClassState; meeting: Meeting; meetings: Meeting[]; onClose: () => void }) {
  const run = useRun();
  // A course usually has one professor: the name already saved on another meeting of the course is filled in.
  const knownInstructor = (courseId: string) => meetings.find((x) => x.courseId === courseId && x.id !== meeting.id && x.instructor)?.instructor ?? '';
  const [m, setM] = useState(() => (meeting.id ? meeting : { ...meeting, instructor: knownInstructor(meeting.courseId) }));
  // Once the officer types a name, changing the course leaves it alone.
  const [typedInstructor, setTypedInstructor] = useState(false);
  const pickCourse = (courseId: string) => {
    if (typedInstructor) return setM({ ...m, courseId });
    const saved = meeting.id && courseId === meeting.courseId ? meeting.instructor : '';
    setM({ ...m, courseId, instructor: saved || knownInstructor(courseId) });
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meetingText = (x: Meeting) =>
    `${state.courses.find((c) => c.id === x.courseId)?.name ?? 'Course'}, ${DAY_SHORT[x.dayOfWeek]} ${clockText(x.startMinutes)} to ${clockText(x.endMinutes)}${x.room.trim() ? `, ${x.room.trim()}` : ''}`;
  if (confirmDelete)
    return (
      <ConfirmDialog
        title="Delete this meeting?"
        text="It will be removed from the timetable for everyone in the class. Attendance already taken is kept."
        confirm="Delete"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(
            'Meeting deleted.',
            () => deleteMeeting(db, state.classId, meeting.id, { actorUid: state.myUid, kind: 'MEETING_DELETED', text: `Deleted the timetable meeting ${meetingText(meeting)}` }),
            onClose,
          )
        }
      />
    );
  return (
    <Dialog
      title={meeting.id ? 'Edit meeting' : 'Add meeting'}
      onClose={onClose}
      actions={
        <>
          {meeting.id && (
            <button className="btn text danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn solid"
            onClick={() =>
              run(
                'Meeting saved.',
                () =>
                  saveMeeting(db, state.classId, m, {
                    actorUid: state.myUid,
                    kind: meeting.id ? 'MEETING_EDITED' : 'MEETING_ADDED',
                    text: meeting.id ? `Edited the timetable meeting ${meetingText(meeting)} (now ${meetingText(m)})` : `Added the timetable meeting ${meetingText(m)}`,
                  }),
                onClose,
              )
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Course">
          <select value={m.courseId} onChange={(e) => pickCourse(e.target.value)}>
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
        <Field label="Professor or instructor (optional)">
          <input value={m.instructor} maxLength={80} onChange={(e) => (setTypedInstructor(true), setM({ ...m, instructor: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  );
}

const NO_CLASS_REASONS = ['Holiday', 'Class suspension', 'Instructor not available', 'University event', 'Exam week'];

/**
 * Marks one or more days as no classes. The officer picks days on a week strip (several at once for a
 * suspension or a break), unticks any class that will still meet, gives a reason, and confirms. A day whose
 * classes are all ticked is saved as a whole-day mark; otherwise one mark per course.
 */
function NoClassDialog({ state, meetings, onClose }: { state: ClassState; meetings: Meeting[]; onClose: () => void }) {
  const run = useRun();
  const marks = useNoClass(db, state.classId, true).data ?? [];
  // Only officers who take attendance can read the sheets; for them, a warning when one was already taken.
  const sheets = useAttendance(db, state.classId, state.can('ATTENDANCE_MANAGE')).data ?? [];
  const today = manilaDay(Date.now()).dateKey;
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [picked, setPicked] = useState<string[]>([]);
  // Classes start unticked on a picked day; the officer ticks the ones that will not meet.
  const [tickedKeys, setTickedKeys] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const courseColor = (id: string) => state.courses.find((c) => c.id === id)?.color || undefined;
  const meetingsOnDay = (day: string) => meetings.filter((m) => m.dayOfWeek === weekdayOf(day)).sort((a, b) => a.startMinutes - b.startMinutes);
  const alreadyOff = (day: string, courseId: string) => marks.some((k) => k.dateKey === day && (!k.courseId || k.courseId === courseId));
  const open = (day: string) => meetingsOnDay(day).filter((m) => !alreadyOff(day, m.courseId));
  const tickKey = (day: string, m: Meeting) => `${day}|${m.id}`;
  const ticked = (day: string, m: Meeting) => tickedKeys.includes(tickKey(day, m));
  const taken = (day: string, m: Meeting) => sheets.some((x) => x.id === sheetId(day, m.id));
  const days = [...picked].sort();
  const chosen = days.flatMap((day) => open(day).filter((m) => ticked(day, m)).map((m) => ({ day, m })));
  const chosenDays = [...new Set(chosen.map((x) => x.day))];
  const takenCount = chosen.filter((x) => taken(x.day, x.m)).length;

  const toggleDay = (day: string) => {
    if (picked.includes(day)) {
      setPicked(picked.filter((d) => d !== day));
      setTickedKeys(tickedKeys.filter((k) => !k.startsWith(`${day}|`)));
    } else {
      setPicked([...picked, day]);
    }
  };
  const toggleMeeting = (key: string) => setTickedKeys(tickedKeys.includes(key) ? tickedKeys.filter((k) => k !== key) : [...tickedKeys, key]);

  /** What gets saved: a whole-day mark when every class of the day is ticked and none was marked before, else one per course. */
  const toSave = () =>
    chosenDays.flatMap((day) => {
      const all = meetingsOnDay(day);
      const ones = chosen.filter((x) => x.day === day).map((x) => x.m);
      if (ones.length === all.length) return [{ dateKey: day, courseId: '' }];
      return [...new Set(ones.map((m) => m.courseId))].map((courseId) => ({ dateKey: day, courseId }));
    });
  const save = () => {
    const count = chosen.length;
    const marked = toSave();
    const text = `Marked No classes: ${noClassText(marked, courseName)}${reason.trim() ? `. Reason: ${reason.trim()}` : ''}`;
    run(`Marked ${count} class${count === 1 ? '' : 'es'} as no classes.`, () => addNoClasses(db, state.myUid, state.classId, marked, reason, text), onClose);
  };

  if (confirming && chosen.length > 0) {
    const more = chosenDays.length - 1;
    return (
      <Dialog
        title={`Mark ${chosen.length} class${chosen.length === 1 ? '' : 'es'} as no classes?`}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <button className="btn text" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn solid danger" onClick={save}>
              Mark no classes
            </button>
          </>
        }
      >
        <div className="att-summary" style={{ marginTop: 0 }}>
          {chosenDays.map((day) => {
            const ones = chosen.filter((x) => x.day === day).map((x) => x.m);
            return (
              <div key={day} className="nc-confirm-day">
                <b>{niceDate(day)}</b>
                <span className="muted">
                  {`${ones.length === meetingsOnDay(day).length ? 'Whole day · ' : ''}${ones.map((m) => `${clockText(m.startMinutes)} ${courseName(m.courseId)}`).join('; ')}`}
                </span>
              </div>
            );
          })}
          {reason.trim() && (
            <div className="nc-confirm-day">
              <span>
                <span className="muted">Reason:</span> {reason.trim()}
              </span>
            </div>
          )}
        </div>
        {takenCount > 0 && <Notice tone="warning">{`${takenCount} of these already ${takenCount === 1 ? 'has' : 'have'} attendance. It stays saved and still counts.`}</Notice>}
        <p className="small muted" style={{ margin: 0 }}>
          {`Students in these classes get one notification: "No classes on ${niceDate(chosenDays[0])}${more > 0 ? ` and ${more} more day${more === 1 ? '' : 's'}` : ''}"${reason.trim() ? ', with the reason' : ''}.`}
        </p>
      </Dialog>
    );
  }

  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const monthDay = (day: string) => niceDate(day).replace(/^[A-Za-z]+, /, '');
  return (
    <Dialog
      title="No classes"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
            Next
          </button>
        </>
      }
    >
      <div className="stack">
        <div>
          <div className="att-week-nav">
            <button type="button" className="att-arrow" aria-label="Earlier week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              ‹
            </button>
            <span className="semibold">{`${monthDay(week[0])} to ${monthDay(week[6])}`}</span>
            <button type="button" className="att-arrow" aria-label="Later week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              ›
            </button>
          </div>
          <div className="att-week">
            {week.map((day) => {
              const all = meetingsOnDay(day);
              const left = open(day);
              const off = all.length > 0 && left.length === 0;
              const on = picked.includes(day);
              const sub = off ? 'NC' : all.length === 0 ? '' : on ? `${left.filter((m) => ticked(day, m)).length} of ${left.length}` : `${left.length}`;
              const label = `${niceDate(day)}: ${all.length === 0 ? 'no classes in the timetable' : off ? 'already no classes' : `${left.length} class${left.length === 1 ? '' : 'es'}${on ? ', picked' : ''}`}`;
              return (
                <button
                  key={day}
                  type="button"
                  className={'att-day' + (off ? ' cancelled' : '') + (on ? ' nc-picked' : '')}
                  disabled={all.length === 0 || off}
                  aria-pressed={on}
                  aria-label={label}
                  onClick={() => toggleDay(day)}
                >
                  <span className="att-dow">{DAY_SHORT[weekdayOf(day)]}</span>
                  <span className="att-num">{Number(day.slice(8, 10))}</span>
                  <span className="att-nc">{sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {days.map((day) => {
            const left = open(day);
            const allOn = left.every((m) => ticked(day, m));
            return (
              <div key={day} className="att-meetings">
                <div className="nc-day-head">
                  <span className="grow">{niceDate(day)}</span>
                  <button
                    type="button"
                    className="btn text small"
                    onClick={() => setTickedKeys(allOn ? tickedKeys.filter((k) => !k.startsWith(`${day}|`)) : [...tickedKeys.filter((k) => !k.startsWith(`${day}|`)), ...left.map((m) => tickKey(day, m))])}
                  >
                    {allOn ? 'Untick all' : 'Tick all'}
                  </button>
                </div>
                {meetingsOnDay(day).map((m) => {
                  const off = alreadyOff(day, m.courseId);
                  const on = !off && ticked(day, m);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={off}
                      className={'att-meeting nc-meeting' + (on ? ' on' : '')}
                      onClick={() => toggleMeeting(tickKey(day, m))}
                    >
                      <span className="nc-box" aria-hidden>
                        {on ? '✓' : ''}
                      </span>
                      <span className="grow">
                        <span className="att-meeting-title">
                          <span className="semibold">{clockText(m.startMinutes)}</span> <CourseDot color={courseColor(m.courseId)} />
                          {courseName(m.courseId)}
                        </span>
                        {off ? (
                          <span className="att-status">Already no classes</span>
                        ) : taken(day, m) ? (
                          <span className="att-status warn">Attendance was already taken for this class</span>
                        ) : (
                          <span className="att-status">{`${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}${m.room ? ` · ${m.room}` : ''}`}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}

        <div>
          <div className="small semibold muted" style={{ marginBottom: 6 }}>
            Reason (optional)
          </div>
          <div className="nc-reasons">
            {NO_CLASS_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} className={'nc-reason' + (reason === r ? ' on' : '')} onClick={() => setReason(reason === r ? '' : r)}>
                {r}
              </button>
            ))}
          </div>
          <input
            className="input"
            style={{ marginTop: 8 }}
            aria-label="Reason (optional)"
            placeholder="Or type your own"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {chosen.length > 0 && (
          <div className="nc-summary">
            <b>{`${chosen.length} class${chosen.length === 1 ? '' : 'es'}`}</b>
            {` on ${chosenDays.length} day${chosenDays.length === 1 ? '' : 's'} will be marked no classes.`}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Attendance

const weekdayOf = (dateKey: string) => (dateKey ? new Date(`${dateKey}T00:00:00Z`).getUTCDay() : -1);

/** Minutes after midnight, Philippine time (UTC+8, no daylight saving). */
const manilaMinutes = (millis: number) => {
  const d = new Date(millis + 8 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** The YYYY-MM-DD date n days after this one. */
const addDays = (dateKey: string, n: number) => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (dateKey: string) => addDays(dateKey, -((weekdayOf(dateKey) + 6) % 7));
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue, Nov 17 (whole day); Thu, Nov 19 (Software Engineering)", for History entries about No classes marks. */
function noClassText(marks: { dateKey: string; courseId: string }[], courseName: (id: string) => string): string {
  const days = [...new Set(marks.map((k) => k.dateKey))].sort();
  return days
    .map((day) => {
      const here = marks.filter((k) => k.dateKey === day);
      const what = here.some((k) => !k.courseId) ? 'whole day' : here.map((k) => courseName(k.courseId)).join(', ');
      return `${niceDate(day)} (${what})`;
    })
    .join('; ');
}

/** "a quoted snippet", cut short for a History entry. */
const snippet = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const MARK_LABELS: Record<AttendanceMark, string> = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused' };
const MARKS: AttendanceMark[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
/** "8:12 AM" in Philippine time. */

/** A saved sheet as one mark per student (everyone not listed was present). */
function marksOf(sheet: { absent: string[]; late: string[]; excused?: string[] } | undefined): Record<string, AttendanceMark> {
  const out: Record<string, AttendanceMark> = {};
  for (const uid of sheet?.late ?? []) out[uid] = 'LATE';
  for (const uid of sheet?.excused ?? []) out[uid] = 'EXCUSED';
  // Absent wins, as in the export.
  for (const uid of sheet?.absent ?? []) out[uid] = 'ABSENT';
  return out;
}

/**
 * The officer marks each student of one meeting on one date. Everyone starts as present. A week strip and
 * the meeting list show what is already taken, and saving asks first: a new sheet shows who is late, absent
 * and excused; replacing a saved one shows only what changed.
 */
function AttendanceDialog({ state, meetings, onClose }: { state: ClassState; meetings: Meeting[]; onClose: () => void }) {
  const run = useRun();
  const sheets = useAttendance(db, state.classId, true).data;
  const noClass = useNoClass(db, state.classId, true).data ?? [];
  const now = useClockTick();
  const today = manilaDay(now).dateKey;
  const [dateKey, setDateKey] = useState(today);
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [pickedId, setPickedId] = useState('');
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  const [confirming, setConfirming] = useState(false);
  // A meeting marked "No classes" opens without the student list until the officer chooses to take it anyway.
  const [anyway, setAnyway] = useState(false);
  const [removingSheet, setRemovingSheet] = useState(false);

  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const courseColor = (id: string) => state.courses.find((c) => c.id === id)?.color || undefined;
  const sheetFor = (day: string, meetingId: string) => sheets?.find((x) => x.id === sheetId(day, meetingId));
  const cancelledOn = (day: string, courseId: string) => noClass.find((x) => x.dateKey === day && (!x.courseId || x.courseId === courseId));
  const meetingsOnDay = (day: string) => meetings.filter((m) => m.dayOfWeek === weekdayOf(day)).sort((a, b) => a.startMinutes - b.startMinutes);
  const takerName = (uid: string) => state.members.find((m) => m.id === uid)?.name ?? 'a former member';

  const todays = meetingsOnDay(dateKey);
  // Unless one was picked: the first meeting not taken yet, preferring one that has already started today.
  const started = (m: Meeting) => dateKey < today || m.startMinutes <= manilaMinutes(now);
  const meeting =
    todays.find((m) => m.id === pickedId) ??
    todays.find((m) => !sheetFor(dateKey, m.id) && started(m)) ??
    todays.find((m) => !sheetFor(dateKey, m.id)) ??
    todays[0];
  const students = meeting ? byLastName(state.members.filter((m) => !m.excludedCourseIds.includes(meeting.courseId))) : [];
  const saved = meeting ? sheetFor(dateKey, meeting.id) : undefined;
  const cancelled = meeting ? cancelledOn(dateKey, meeting.courseId) : undefined;
  const key = `${dateKey}|${meeting?.id ?? ''}|${saved?.takenAtMillis ?? 0}`;

  // Starts from what was saved for this meeting and date, if anything.
  useEffect(() => {
    setMarks(marksOf(saved));
    setAnyway(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const markOf = (uid: string) => marks[uid] ?? 'PRESENT';
  const withMark = (m: AttendanceMark) => students.filter((s) => markOf(s.id) === m);
  const savedMarks = marksOf(saved);
  const changes = saved ? students.filter((s) => (savedMarks[s.id] ?? 'PRESENT') !== markOf(s.id)) : [];
  const hold = !!meeting && !saved && !!cancelled && !anyway;
  const canSave = !!meeting && sheets !== undefined && !hold && (!saved || changes.length > 0);

  const pickDay = (day: string) => {
    setDateKey(day);
    setWeekStart(mondayOf(day));
    setPickedId('');
  };
  const save = () => {
    if (!meeting) return;
    const counts = `${withMark('PRESENT').length} present, ${withMark('LATE').length} late, ${withMark('ABSENT').length} absent, ${withMark('EXCUSED').length} excused`;
    const which = `${courseName(meeting.courseId)}, ${niceDate(dateKey)} ${clockText(meeting.startMinutes)}`;
    const logText = saved
      ? `Changed the attendance for ${which}: ${changes.map((s) => `${listName(s)} ${MARK_LABELS[savedMarks[s.id] ?? 'PRESENT']} to ${MARK_LABELS[markOf(s.id)]}`).join('; ')}`
      : `Took attendance for ${which}: ${counts}${cancelled ? ' (the day was marked No classes)' : ''}`;
    run(`${saved ? 'Attendance replaced' : 'Attendance saved'}: ${counts}.`, () =>
      saveAttendance(db, state.myUid, state.classId, dateKey, meeting, Object.fromEntries(students.map((m) => [m.id, markOf(m.id)])), !saved, logText), onClose);
  };

  if (removingSheet && meeting && saved) {
    return (
      <ConfirmDialog
        title="Remove this attendance?"
        text={`${courseName(meeting.courseId)} · ${niceDate(dateKey)} goes back to not taken. The marks saved for it are deleted.`}
        confirm="Remove"
        danger
        onClose={() => setRemovingSheet(false)}
        onConfirm={() =>
          run(
            'Attendance removed.',
            () =>
              removeAttendance(db, state.classId, saved, {
                actorUid: state.myUid,
                kind: 'ATTENDANCE_REMOVED',
                text: `Removed the attendance for ${courseName(meeting.courseId)}, ${niceDate(dateKey)} ${clockText(meeting.startMinutes)} (taken by ${takerName(saved.takenByUid)} on ${shortDateTime(saved.takenAtMillis)})`,
              }),
            () => setRemovingSheet(false),
          )
        }
      />
    );
  }

  if (confirming && meeting) {
    const where = `${courseName(meeting.courseId)} · ${niceDate(dateKey)} · ${clockText(meeting.startMinutes)}`;
    const names = (list: typeof students) => (list.length ? list.map(listName).join('; ') : 'None');
    return (
      <Dialog
        title={saved ? 'Replace saved attendance?' : 'Save attendance?'}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <button className="btn text" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn solid" onClick={save}>
              {saved ? 'Replace' : 'Save'}
            </button>
          </>
        }
      >
        <p className="small muted" style={{ margin: 0 }}>
          {saved ? `${where} · Saved ${shortDateTime(saved.takenAtMillis)} by ${takerName(saved.takenByUid)}` : where}
        </p>
        {saved ? (
          <div className="att-summary">
            <div className="small semibold">{`${changes.length} change${changes.length === 1 ? '' : 's'}`}</div>
            {changes.map((s) => (
              <div key={s.id} className="att-change">
                <span>{listName(s)}</span>
                <span>
                  {MARK_LABELS[savedMarks[s.id] ?? 'PRESENT']} <span className="muted">→</span> <b>{MARK_LABELS[markOf(s.id)]}</b>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="att-summary">
            {(['LATE', 'ABSENT', 'EXCUSED'] as AttendanceMark[]).map((m) => (
              <div key={m} className="att-sum-row">
                <span className="muted">{`${MARK_LABELS[m]} (${withMark(m).length})`}</span>
                <span>{names(withMark(m))}</span>
              </div>
            ))}
            <div className="att-sum-row">
              <span className="muted">Present</span>
              <span>{withMark('PRESENT').length === students.length ? `${students.length} (everyone)` : `${withMark('PRESENT').length} others`}</span>
            </div>
          </div>
        )}
      </Dialog>
    );
  }

  const weekLength = 7;
  const week = Array.from({ length: weekLength }, (_, i) => addDays(weekStart, i));
  const monthDay = (day: string) => niceDate(day).replace(/^[A-Za-z]+, /, '');
  return (
    <Dialog
      title="Take attendance"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" disabled={!canSave} onClick={() => setConfirming(true)}>
            {saved ? (changes.length ? 'Update' : 'No changes') : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>
          <div className="att-week-nav">
            <button type="button" className="att-arrow" aria-label="Earlier week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              ‹
            </button>
            <span className="semibold">{`${monthDay(week[0])} to ${monthDay(week[week.length - 1])}`}</span>
            <button type="button" className="att-arrow" aria-label="Later week" disabled={addDays(weekStart, 7) > today} onClick={() => setWeekStart(addDays(weekStart, 7))}>
              ›
            </button>
          </div>
          <div className="att-week">
            {week.map((day) => {
              const list = meetingsOnDay(day);
              const nc = list.length > 0 && list.every((m) => cancelledOn(day, m.courseId)) && !list.some((m) => sheetFor(day, m.id));
              const taken = list.filter((m) => sheetFor(day, m.id)).length;
              const done = list.length > 0 && taken === list.length;
              const label = `${niceDate(day)}: ${list.length === 0 ? 'no classes in the timetable' : nc ? 'no classes' : `${taken} of ${list.length} taken`}`;
              return (
                <button
                  key={day}
                  type="button"
                  className={'att-day' + (done ? ' done' : '') + (nc ? ' cancelled' : '') + (day === dateKey ? ' selected' : '')}
                  disabled={day > today}
                  aria-label={label}
                  aria-pressed={day === dateKey}
                  onClick={() => pickDay(day)}
                >
                  <span className="att-dow">{DAY_SHORT[weekdayOf(day)]}</span>
                  <span className="att-num">{Number(day.slice(8, 10))}</span>
                  <span className="att-dots">
                    {nc ? (
                      <span className="att-nc">NC</span>
                    ) : (
                      list.map((m) => <i key={m.id} className={'att-dot' + (sheetFor(day, m.id) ? ' on' : cancelledOn(day, m.courseId) ? ' nc' : '')} />)
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {todays.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>{`The timetable has no classes on ${niceDate(dateKey)}.`}</p>
        ) : (
          <div className="att-meetings" role="radiogroup" aria-label="Class meeting">
            {todays.map((m) => {
              const sheet = sheetFor(dateKey, m.id);
              const off = cancelledOn(dateKey, m.courseId);
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === meeting?.id}
                  className={'att-meeting' + (sheet ? ' taken' : '') + (m.id === meeting?.id ? ' selected' : '')}
                  onClick={() => setPickedId(m.id)}
                >
                  <span className="att-radio" />
                  <span className="grow">
                    <span className="att-meeting-title">
                      <span className="semibold">{clockText(m.startMinutes)}</span> <CourseDot color={courseColor(m.courseId)} />
                      {courseName(m.courseId)}
                    </span>
                    {sheet ? (
                      <span className="att-status ok">
                        ✓ Taken
                        {off && (
                          <span className="att-nc-tag">
                            <StatusBadge status="danger">Marked No classes</StatusBadge>
                          </span>
                        )}
                      </span>
                    ) : off ? (
                      <span className="att-status">
                        <StatusBadge status="danger">{`No classes${off.reason ? `: ${off.reason}` : ''}`}</StatusBadge>
                      </span>
                    ) : (
                      <span className="att-status">Not taken yet</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {meeting && saved && (
          <div className="att-banner taken">
            <span className="grow">{`Taken on ${shortDateTime(saved.takenAtMillis)} by ${takerName(saved.takenByUid)}.`}</span>
            <Button size="small" variant="text" danger onClick={() => setRemovingSheet(true)}>
              Remove
            </Button>
          </div>
        )}
        {hold && (
          <div className="att-hold">
            <Button variant="outline" onClick={() => setAnyway(true)}>
              Take attendance anyway
            </Button>
          </div>
        )}

        {meeting && !hold && (
          <div className="ch-row ch-wrap ch-gap-2">
            <Badge tone="success">{`${withMark('PRESENT').length} present`}</Badge>
            <Badge tone="warning">{`${withMark('LATE').length} late`}</Badge>
            <Badge tone="danger">{`${withMark('ABSENT').length} absent`}</Badge>
            <Badge tone="info">{`${withMark('EXCUSED').length} excused`}</Badge>
          </div>
        )}

        <div className="att-students">
          {!hold && students.map((m) => (
            <div key={m.id} className="att-student">
              <span className="grow">{listName(m)}</span>
              <span className="att-seg" role="radiogroup" aria-label={`Attendance of ${m.name}`}>
                {MARKS.map((mark) => (
                  <button
                    key={mark}
                    type="button"
                    role="radio"
                    aria-checked={markOf(m.id) === mark}
                    data-mark={mark}
                    className={markOf(m.id) === mark ? 'on' : ''}
                    onClick={() => setMarks({ ...marks, [m.id]: mark })}
                  >
                    {MARK_LABELS[mark]}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** In the Schedule tab: a student's own absences, lates and excused days per course; officers also get everyone's counts. */
export function AttendanceCard({ state }: { state: ClassState }) {
  const manage = state.can('ATTENDANCE_MANAGE');
  const mine = useMyAttendance(db, state.classId, state.myUid, true);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [openMine, setOpenMine] = useState<string | null>(null);
  const { actions } = useClass();
  const all = useAttendance(db, state.classId, manage).data ?? [];
  // For the export: cancelled meetings get their own NC column.
  const meetings = useMeetings(db, state.classId, manage).data ?? [];
  const noClass = useNoClass(db, state.classId, manage).data ?? [];
  const totals = useAttendanceTotals(db, state.classId, true);
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  // Marks from a course the student no longer takes stay in the records but are not shown or counted.
  const courseIds = [...new Set([...mine.absent, ...mine.late, ...mine.excused].map((x) => x.courseId))].filter((id) => state.takes(id));
  const perCourse = [...new Set(all.map((x) => x.courseId))].map((courseId) => {
    const sheets = all.filter((x) => x.courseId === courseId);
    const rows = state.members
      .filter((m) => !m.excludedCourseIds.includes(courseId))
      .map((m) => ({
        id: m.id,
        name: listName(m),
        absent: sheets.filter((x) => x.absent.includes(m.id)).length,
        late: sheets.filter((x) => x.late.includes(m.id)).length,
        excused: sheets.filter((x) => x.excused.includes(m.id)).length,
      }))
      .filter((r) => r.absent || r.late || r.excused)
      .sort((a, b) => b.absent - a.absent || b.late - a.late || b.excused - a.excused);
    return { courseId, taken: sheets.length, rows };
  });
  const counts = (absent: number, late: number, excused: number) => (
    <>
      {absent > 0 && <Badge tone="danger">{`${absent} absent`}</Badge>}
      {late > 0 && <Badge tone="warning">{`${late} late`}</Badge>}
      {excused > 0 && <Badge tone="info">{`${excused} excused`}</Badge>}
    </>
  );
  const [untaken, setUntaken] = useState<{ dateKey: string; courseId: string }[] | null>(null);
  // Warns first when a class meeting since attendance began has no sheet and was not marked "No classes".
  function exportAttendance() {
    const known = meetings.filter((m) => state.courses.some((c) => c.id === m.courseId));
    const missing = untakenMeetings(known, all, noClass, manilaDay(Date.now()).dateKey, manilaMinutes(Date.now()));
    if (missing.length > 0) setUntaken(missing);
    else writeExport();
  }
  function writeExport() {
    const courses = [...state.courses].sort((x, y) => x.name.localeCompare(y.name));
    const students = byLastName(state.members).map((m) => ({ id: m.id, name: listName(m), excludedCourseIds: m.excludedCourseIds }));
    // One sheet per course. Columns: name, days attended, then a column per day attendance was taken or the meeting was cancelled.
    const cancellations = { noClass, meetings, todayKey: manilaDay(Date.now()).dateKey };
    const sheets = attendanceExportSheets(courses, students, all, cancellations).map((s) => ({ ...s, widths: [30, 10, ...s.rows[0].slice(2).map(() => 10)] }));
    if (sheets.length === 0) return;
    const bytes = xlsxFile(sheets);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveFile(`${state.room?.name ?? 'class'} attendance.xlsx`, blob, actions.showNotice).catch((e) => actions.showNotice(friendlyMessage(e)));
  }
  // Nothing to show until attendance has been taken at least once.
  if (Object.keys(totals).length === 0 && courseIds.length === 0 && perCourse.length === 0) return null;
  return (
    <>
      <Section title="My attendance">
        {courseIds.length === 0 ? (
          <Notice tone="success">No absences, lates or excused days recorded for you.</Notice>
        ) : (
          <Card flush>
            {courseIds.map((id) => {
              const a = mine.absent.filter((x) => x.courseId === id);
              const l = mine.late.filter((x) => x.courseId === id);
              const e = mine.excused.filter((x) => x.courseId === id);
              return (
                <ListRow
                  key={id}
                  title={
                    <span className="ch-row ch-wrap" style={{ gap: 8 }}>
                      <span className="ch-grow">
                        <CourseDot color={state.courses.find((c) => c.id === id)?.color} />
                        {courseName(id)}
                      </span>
                      <span className="ch-row" style={{ gap: 6 }}>{counts(a.length, l.length, e.length)}</span>
                    </span>
                  }
                  subtitle={totals[id] ? `Out of ${totals[id]} meeting${totals[id] === 1 ? '' : 's'}` : undefined}
                  chevron
                  onClick={() => setOpenMine(id)}
                />
              );
            })}
          </Card>
        )}
        {openMine && (
          <Dialog
            title={`My attendance: ${courseName(openMine)}`}
            onClose={() => setOpenMine(null)}
            actions={
              <button className="btn text" onClick={() => setOpenMine(null)}>
                Close
              </button>
            }
          >
            <div className="stack">
              {([['Absent', mine.absent], ['Late', mine.late], ['Excused', mine.excused]] as const).map(([label, list]) => {
                const days = list.filter((x) => x.courseId === openMine).map((x) => x.dateKey).sort();
                if (days.length === 0) return null;
                return (
                  <div key={label}>
                    <div className="ch-small ch-muted" style={{ fontWeight: 700, marginBottom: 4 }}>{`${label} (${days.length})`}</div>
                    {days.map((day) => (
                      <div key={day}>{niceDate(day)}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </Dialog>
        )}
      </Section>
      {manage && (
        <Section
          title="Class attendance"
          action={
            perCourse.length > 0 ? (
              <Button size="small" variant="text" icon="download" onClick={exportAttendance}>
                Export to Excel
              </Button>
            ) : undefined
          }
        >
          {perCourse.length === 0 ? (
            <Notice tone="info">No attendance taken yet. Use "Take attendance" in the timetable above.</Notice>
          ) : (
            <Card flush>
              {perCourse.map((c) => (
                <ListRow
                  key={c.courseId}
                  title={<><CourseDot color={state.courses.find((x) => x.id === c.courseId)?.color} />{courseName(c.courseId)}</>}
                  subtitle={`Taken ${times(c.taken)}`}
                  chevron={c.rows.length > 0}
                  onClick={c.rows.length > 0 ? () => setOpenCourse(c.courseId) : undefined}
                />
              ))}
            </Card>
          )}
          {perCourse
            .filter((c) => c.courseId === openCourse)
            .map((c) => (
              <Dialog
                key={c.courseId}
                title={`Attendance: ${courseName(c.courseId)}`}
                onClose={() => setOpenCourse(null)}
                actions={
                  <button className="btn text" onClick={() => setOpenCourse(null)}>
                    Close
                  </button>
                }
              >
                <p className="small muted" style={{ marginTop: 0 }}>
                  Taken {times(c.taken)}.
                </p>
                <Card flush>
                  {c.rows.map((r) => (
                    <ListRow key={r.id} title={r.name} trailing={counts(r.absent, r.late, r.excused)} />
                  ))}
                </Card>
              </Dialog>
            ))}
        </Section>
      )}
      {untaken && (
        <ConfirmDialog
          title={`${untaken.length} ${untaken.length === 1 ? 'class has' : 'classes have'} no attendance yet`}
          text={
            <span className="att-untaken">
              {untaken.slice(0, 6).map((u) => (
                <span key={`${u.dateKey}|${u.courseId}`}>{`${niceDate(u.dateKey)} · ${courseName(u.courseId)}`}</span>
              ))}
              {untaken.length > 6 && <span className="ch-muted">{`and ${untaken.length - 6} more`}</span>}
            </span>
          }
          confirm="Export anyway"
          onClose={() => setUntaken(null)}
          onConfirm={() => {
            setUntaken(null);
            writeExport();
          }}
        />
      )}
    </>
  );
}

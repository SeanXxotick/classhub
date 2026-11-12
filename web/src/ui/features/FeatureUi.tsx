import { useEffect, useMemo, useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import {
  CLAIM_METHODS,
  CLAIM_METHOD_LABELS,
  addComment,
  addNoClass,
  removeComment,
  setVote,
  tally,
  useComments,
  useVotes,
  type Comment,
  type VoteMarks,
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
import { Ledger } from '../../domain/ledger';
import { ROLE_MEMBER, byLastName, listName } from '../../data/models';
import { formatMoney, parsePesos } from '../../domain/money';
import { courseShortName, layoutWeek } from '../../domain/weekGrid';
import { attendanceExportSheets } from '../../domain/attendanceExport';
import { xlsxFile } from '../../domain/xlsx';
import { Avatar, ConfirmDialog, CourseDot, Dialog, EXPORT_IN_BROWSER, Field, RoleChip, hexColor, inAndroidApp, shortDate, shortDateTime } from '../common';
import { Badge, Button, Card, DayHeader, Icon, ListRow, Money, Notice, Section, StatusBadge, TypeIcon } from '../../design';
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
        !manage && <Notice tone="info">Paid by GCash or bank? Tap "I paid" so the treasurer can confirm it.</Notice>
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

// ---------------------------------------------------------------- Statement and export

function download(name: string, text: string) {
  downloadBlob(name, new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
    if (inAndroidApp()) return actions.showNotice(EXPORT_IN_BROWSER);
    const head = ['Date', 'Type', 'Student', 'Amount', 'Note', 'Paid to', 'Voided', 'Void reason'].map(cell).join(',');
    const rows = [...state.records]
      .sort((a, b) => a.dateMillis - b.dateMillis)
      .map((r) => [manilaDay(r.dateMillis).dateKey, r.type, r.memberName, pesos(r.amountCentavos), r.note, r.paidTo, r.voidedAtMillis ? 'yes' : '', r.voidReason].map(cell).join(','));
    const balances = state.members.map((m) => [m.name, pesos(state.balanceOf(m.id))].map(cell).join(','));
    download(`${state.room?.name ?? 'class'} ledger.csv`, [head, ...rows, '', [cell('Student'), cell('Balance')].join(','), ...balances].join('\r\n'));
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
  const posts = useAnnouncements(db, state.classId, true).data;
  const seen = useSeen(db, state.classId, true).data ?? [];
  const votes = useVotes(db, state.classId, true).data ?? [];
  const memberIds = useMemo(() => new Set(state.members.map((m) => m.id)), [state.members]);
  const run = useRun();
  const [openId, setOpenId] = useState('');
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [seenOf, setSeenOf] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const mySeen = seen.find((s) => s.id === state.myUid)?.announcements ?? {};
  const unseen = (posts ?? []).filter((p) => !mySeen[p.id]).map((p) => p.id).join(',');

  // Showing the list counts as opening the posts.
  useEffect(() => {
    if (unseen) markSeen(db, state.classId, state.myUid, unseen.split(',')).catch(() => {});
  }, [unseen, state.classId, state.myUid]);

  const seenBy = (id: string) => seen.filter((s) => s.announcements[id] && state.members.some((m) => m.id === s.id)).length;

  return (
    <div className="stack">
      {manage && (
        <div className="ch-row">
          <Button icon="bell" onClick={() => setEditing(newAnnouncement({}))}>
            New announcement
          </Button>
        </div>
      )}
      {posts && posts.length === 0 && <Notice tone="info">No announcements yet.</Notice>}
      {(posts ?? []).map((p) => (
        <Card key={p.id}>
          <div className="stack" style={{ gap: 8 }}>
            {p.pinned && (
              <div className="ch-row">
                <Badge tone="primary" icon="pin">
                  Pinned
                </Badge>
              </div>
            )}
            <Byline state={state} uid={p.createdByUid} fallback="A former member" when={p.createdAtMillis} edited={!!p.editedAtMillis} size={40} />
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
              <Button size="small" variant="outline" icon="eye" onClick={() => setSeenOf(p)}>
                {`Seen by ${seenBy(p.id)} of ${state.members.length}`}
              </Button>
            </div>
            {manage && (
              <div className="ch-row ch-wrap ch-gap-2">
                <Button size="small" variant="outline" icon="edit" onClick={() => setEditing(p)}>
                  Edit
                </Button>
                <Button size="small" variant="outline" icon="pin" onClick={() => run(p.pinned ? 'Unpinned.' : 'Pinned.', () => saveAnnouncement(db, state.myUid, state.classId, { ...p, pinned: !p.pinned }))}>
                  {p.pinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button size="small" variant="outline" danger icon="trash" onClick={() => setDeleting(p)}>
                  Delete
                </Button>
              </div>
            )}
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
                    <ListRow key={m.id} leading={<TypeIcon icon={did ? 'check' : 'hourglass'} tone={did ? 'success' : 'neutral'} size={32} />} title={listName(m)} />
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
          onConfirm={() => run('Announcement deleted.', () => deleteAnnouncement(db, state.classId, deleting.id))}
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
      <Byline state={state} uid={c.uid} fallback={c.name} when={c.createdAtMillis} size={28} />
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
            {(c.uid === state.myUid || manage) && (
              <button type="button" className="btn text" onClick={() => setRemoving(c)}>
                Remove
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
          onConfirm={() => run('Comment removed.', () => removeComment(db, state.classId, removing.id))}
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
            onClick={() => run(post.id ? 'Announcement saved.' : 'Announcement posted.', () => saveAnnouncement(db, state.myUid, state.classId, { ...post, title, body, pinned, commentsOff: !comments }), onClose)}
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
function TimeTile({ minutes, cancelled, color }: { minutes: number; cancelled?: boolean; color?: string }) {
  const [clock, half] = clockText(minutes).split(' ');
  return (
    <span
      aria-hidden
      className={cancelled ? 'ch-tone-danger' : 'ch-tone-primary'}
      style={{
        flex: 'none', width: 52, height: 44, borderRadius: 12, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: cancelled ? 'var(--tb)' : color || 'var(--ch-primary)', color: cancelled ? 'var(--tc)' : color ? '#fff' : 'var(--ch-on-primary)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', textDecoration: cancelled ? 'line-through' : undefined,
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 15 }}>{clock}</span>
      <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>{half}</span>
    </span>
  );
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
  if (meetings.length === 0) return null;
  const now = Date.now();
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
              {list.map(({ meeting: m, cancelled }) => (
                <ListRow
                  key={m.id}
                  voided={!!cancelled}
                  leading={<TimeTile minutes={m.startMinutes} cancelled={!!cancelled} color={courseColor(m.courseId)} />}
                  title={courseName(m.courseId)}
                  subtitle={`${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}${m.room ? ` · ${m.room}` : ''}${m.instructor ? ` · ${m.instructor}` : ''}`}
                  trailing={cancelled ? <StatusBadge status="danger">{`No classes${cancelled.reason ? `: ${cancelled.reason}` : ''}`}</StatusBadge> : undefined}
                />
              ))}
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
  const [viewing, setViewing] = useState<Meeting | null>(null);
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const courseColor = (id: string) => state.courses.find((c) => c.id === id)?.color || undefined;
  const now = Date.now();
  const todayKey = manilaDay(now).dateKey;
  // Folded, the card shows only today and tomorrow, so the deadlines below stay within reach.
  const soon: [string, number][] = [['Today', now], ['Tomorrow', now + 86_400_000]];
  const coming = marks.filter((k) => k.dateKey >= todayKey).sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  const viewingCancelled = viewing ? nextCancelled(viewing, meetings, marks, now) : null;

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
                  <DayHeader>{`${label} · ${DAYS[manilaDay(millis).dayOfWeek]}`}</DayHeader>
                  {list.length === 0 && <ListRow leading={<TypeIcon icon="moon" tone="neutral" />} title="No classes" />}
                  {list.map(({ meeting: m, cancelled }) => (
                    <ListRow
                      key={m.id}
                      voided={!!cancelled}
                      leading={<TimeTile minutes={m.startMinutes} cancelled={!!cancelled} color={courseColor(m.courseId)} />}
                      title={courseName(m.courseId)}
                      subtitle={`${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}${m.room ? ` · ${m.room}` : ''}${m.instructor ? ` · ${m.instructor}` : ''}${notMine(m)}`}
                      trailing={cancelled ? <StatusBadge status="danger">{`No classes${cancelled.reason ? `: ${cancelled.reason}` : ''}`}</StatusBadge> : undefined}
                      chevron={manage}
                      onClick={manage ? () => setEditing(m) : undefined}
                    />
                  ))}
                </div>
              );
            })}
          {fullWeek && <WeekGrid state={state} meetings={meetings} marks={marks} onOpen={manage ? setEditing : setViewing} />}
          <div className="ch-row" style={{ padding: '4px 12px 0' }}>
            <Button size="small" variant="text" icon={fullWeek ? 'x' : 'list'} onClick={() => setFullWeek(!fullWeek)}>
              {fullWeek ? 'Show today and tomorrow only' : 'Full week'}
            </Button>
          </div>
        </Card>
      )}
      {coming.length > 0 && (
        <Card flush>
          <DayHeader>No classes</DayHeader>
          {coming.map((k) => (
            <ListRow
              key={k.id}
              leading={<TypeIcon icon="ban" tone="danger" />}
              title={`${niceDate(k.dateKey)} · ${k.courseId ? courseName(k.courseId) : 'Whole day'}`}
              subtitle={k.reason || undefined}
              actions={
                manage ? (
                  <Button size="small" variant="text" onClick={() => run('Classes are back on.', () => removeNoClass(db, state.classId, k.id))}>
                    Remove
                  </Button>
                ) : undefined
              }
            />
          ))}
        </Card>
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
  if (confirmDelete)
    return (
      <ConfirmDialog
        title="Delete this meeting?"
        text="It will be removed from the timetable for everyone in the class. Attendance already taken is kept."
        confirm="Delete"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => run('Meeting deleted.', () => deleteMeeting(db, state.classId, meeting.id), onClose)}
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
          <button className="btn solid" onClick={() => run('Meeting saved.', () => saveMeeting(db, state.classId, m), onClose)}>
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

// ---------------------------------------------------------------- Attendance

const weekdayOf = (dateKey: string) => (dateKey ? new Date(`${dateKey}T00:00:00Z`).getUTCDay() : -1);

/** The officer marks each student of one meeting on one date. Everyone starts as present. */
function AttendanceDialog({ state, meetings, onClose }: { state: ClassState; meetings: Meeting[]; onClose: () => void }) {
  const run = useRun();
  const sheets = useAttendance(db, state.classId, true).data;
  const [dateKey, setDateKey] = useState(manilaDay(Date.now()).dateKey);
  const [pickedId, setPickedId] = useState('');
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  const noClass = useNoClass(db, state.classId, true).data ?? [];
  const today = manilaDay(Date.now()).dateKey;
  const future = dateKey > today;
  const todays = meetings.filter((m) => m.dayOfWeek === weekdayOf(dateKey)).sort((a, b) => a.startMinutes - b.startMinutes);
  const meeting = todays.find((m) => m.id === pickedId) ?? todays[0];
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  const students = meeting ? byLastName(state.members.filter((m) => !m.excludedCourseIds.includes(meeting.courseId))) : [];
  const saved = meeting ? sheets?.find((x) => x.id === sheetId(dateKey, meeting.id)) : undefined;
  const key = `${dateKey}|${meeting?.id ?? ''}|${saved?.takenAtMillis ?? 0}`;
  const cancelled = meeting ? noClass.find((x) => x.dateKey === dateKey && (!x.courseId || x.courseId === meeting.courseId)) : undefined;

  // Starts from what was saved for this meeting and date, if anything.
  useEffect(() => {
    const next: Record<string, AttendanceMark> = {};
    for (const uid of saved?.absent ?? []) next[uid] = 'ABSENT';
    for (const uid of saved?.late ?? []) next[uid] = 'LATE';
    setMarks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const absent = students.filter((m) => marks[m.id] === 'ABSENT').length;
  const late = students.filter((m) => marks[m.id] === 'LATE').length;
  return (
    <Dialog
      title="Take attendance"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn solid"
            disabled={!meeting || sheets === undefined || future}
            onClick={() =>
              meeting &&
              run(`Attendance saved: ${students.length - absent - late} present, ${late} late, ${absent} absent.`, () =>
                saveAttendance(db, state.myUid, state.classId, dateKey, meeting, Object.fromEntries(students.map((m) => [m.id, marks[m.id] ?? 'PRESENT'])), !saved), onClose)
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Date">
          <input type="date" value={dateKey} max={today} onChange={(e) => setDateKey(e.target.value)} />
        </Field>
        {future && <Notice tone="warning">That day has not come yet. Attendance can be taken on the day of the class or after it.</Notice>}
        {!future && cancelled && <Notice tone="warning">{`This day is marked "No classes"${cancelled.reason ? `: ${cancelled.reason}` : ''}. Take attendance only if the class still met.`}</Notice>}
        {todays.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>The timetable has no classes on that day.</p>
        ) : (
          <Field label="Class meeting">
            <select value={meeting?.id ?? ''} onChange={(e) => setPickedId(e.target.value)}>
              {todays.map((m) => (
                <option key={m.id} value={m.id}>
                  {clockText(m.startMinutes)} · {courseName(m.courseId)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {meeting && <div className="small muted">{saved ? 'Already taken. Saving replaces it.' : 'Everyone starts as present. Change only those who were late or absent.'}</div>}
        {students.map((m) => (
          <label key={m.id} className="row">
            <span className="grow">{listName(m)}</span>
            <select className="input" value={marks[m.id] ?? 'PRESENT'} aria-label={`Attendance of ${m.name}`} style={{ width: 'auto', minHeight: 40, padding: '6px 10px' }} onChange={(e) => setMarks({ ...marks, [m.id]: e.target.value as AttendanceMark })}>
              <option value="PRESENT">Present</option>
              <option value="LATE">Late</option>
              <option value="ABSENT">Absent</option>
            </select>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

/** In the Schedule tab: a student's own absences and lates per course; officers also get everyone's counts. */
export function AttendanceCard({ state }: { state: ClassState }) {
  const manage = state.can('ATTENDANCE_MANAGE');
  const mine = useMyAttendance(db, state.classId, state.myUid, true);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [openMine, setOpenMine] = useState<string | null>(null);
  const { actions } = useClass();
  const all = useAttendance(db, state.classId, manage).data ?? [];
  const totals = useAttendanceTotals(db, state.classId, true);
  const courseName = (id: string) => state.courses.find((c) => c.id === id)?.name ?? 'Course';
  // Marks from a course the student no longer takes stay in the records but are not shown or counted.
  const courseIds = [...new Set([...mine.absent, ...mine.late].map((x) => x.courseId))].filter((id) => state.takes(id));
  const perCourse = [...new Set(all.map((x) => x.courseId))].map((courseId) => {
    const sheets = all.filter((x) => x.courseId === courseId);
    const rows = state.members
      .filter((m) => !m.excludedCourseIds.includes(courseId))
      .map((m) => ({ id: m.id, name: listName(m), absent: sheets.filter((x) => x.absent.includes(m.id)).length, late: sheets.filter((x) => x.late.includes(m.id)).length }))
      .filter((r) => r.absent || r.late)
      .sort((a, b) => b.absent - a.absent || b.late - a.late);
    return { courseId, taken: sheets.length, rows };
  });
  const counts = (absent: number, late: number) => (
    <>
      {absent > 0 && <Badge tone="danger">{`${absent} absent`}</Badge>}
      {late > 0 && <Badge tone="warning">{`${late} late`}</Badge>}
    </>
  );
  function exportAttendance() {
    if (inAndroidApp()) return actions.showNotice(EXPORT_IN_BROWSER);
    const courses = [...state.courses].sort((x, y) => x.name.localeCompare(y.name));
    const students = byLastName(state.members).map((m) => ({ id: m.id, name: listName(m), excludedCourseIds: m.excludedCourseIds }));
    // One sheet per course. Columns: name, days attended, then a column per day attendance was taken.
    const sheets = attendanceExportSheets(courses, students, all).map((s) => ({ ...s, widths: [30, 10, ...s.rows[0].slice(2).map(() => 10)] }));
    if (sheets.length === 0) return;
    const bytes = xlsxFile(sheets);
    downloadBlob(`${state.room?.name ?? 'class'} attendance.xlsx`, new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  // Nothing to show until attendance has been taken at least once.
  if (Object.keys(totals).length === 0 && courseIds.length === 0 && perCourse.length === 0) return null;
  return (
    <>
      <Section title="My attendance">
        {courseIds.length === 0 ? (
          <Notice tone="success">No absences or lates recorded for you.</Notice>
        ) : (
          <Card flush>
            {courseIds.map((id) => {
              const a = mine.absent.filter((x) => x.courseId === id);
              const l = mine.late.filter((x) => x.courseId === id);
              return (
                <ListRow
                  key={id}
                  title={
                    <span className="ch-row ch-wrap" style={{ gap: 8 }}>
                      <span className="ch-grow">
                        <CourseDot color={state.courses.find((c) => c.id === id)?.color} />
                        {courseName(id)}
                      </span>
                      <span className="ch-row" style={{ gap: 6 }}>{counts(a.length, l.length)}</span>
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
              {([['Absent', mine.absent], ['Late', mine.late]] as const).map(([label, list]) => {
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
                  subtitle={`Taken ${times(c.taken)} · ${c.rows.length === 0 ? 'nobody absent or late' : `${c.rows.length} student${c.rows.length === 1 ? '' : 's'} with absences or lates`}`}
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
                  Taken {times(c.taken)}. Most absences first. Students who were always present are not listed.
                </p>
                <Card flush>
                  {c.rows.map((r) => (
                    <ListRow key={r.id} title={r.name} trailing={counts(r.absent, r.late)} />
                  ))}
                </Card>
              </Dialog>
            ))}
        </Section>
      )}
    </>
  );
}

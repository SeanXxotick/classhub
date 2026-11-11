import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { BALANCE_VISIBILITIES, type BalanceVisibility, type LedgerRecord, type Member, type RecordType } from '../../data/models';
import { Ledger } from '../../domain/ledger';
import { LEDGER_FILTERS, LedgerView, type ChargeBatch, type LedgerEntry, type LedgerFilter } from '../../domain/ledgerView';
import { formatMoney } from '../../domain/money';
import { dayOf, monthShort, parseDay, plusDays, today, weekday, weekdayShort } from '../../domain/dates';
import { Avatar, CourseDot, DetailLine, Dialog, Field, hexColor } from '../common';
import type { ClassState } from '../classroom/ClassContext';

// ---------------------------------------------------------------- Labels, colors and dates

export const CHARGE_COLOR = '#B91C1C';
const PAYOUT_COLOR = '#CA8A04';
const WITHDRAW_COLOR = '#0369A1';

/** What the user sees for each record type. */
export function recordLabel(type: RecordType): string {
  switch (type) {
    case 'PAYMENT':
      return 'Payment';
    case 'CHARGE':
      return 'Charge students';
    case 'WITHDRAWAL':
      return 'Withdrawal';
    case 'EXPENSE':
      return 'Pay out from fund';
    case 'OPENING':
      return 'Opening balance';
  }
}

function recordColor(type: RecordType): string {
  switch (type) {
    case 'PAYMENT':
      return 'var(--income)';
    case 'CHARGE':
      return CHARGE_COLOR;
    case 'WITHDRAWAL':
      return WITHDRAW_COLOR;
    case 'EXPENSE':
      return PAYOUT_COLOR;
    case 'OPENING':
      return 'var(--income)';
  }
}

/** "Today", "Yesterday" or "Fri, Oct 16". */
export function dayHeader(millis: number): string {
  const day = dayOf(millis);
  const now = today();
  if (day === now) return 'Today';
  if (day === plusDays(now, -1)) return 'Yesterday';
  const { month, day: d } = parseDay(day);
  return `${weekdayShort(weekday(day))}, ${monthShort(month)} ${d}`;
}

/** "Oct 18, 2026" */
export function fullDate(millis: number): string {
  const { year, month, day } = parseDay(dayOf(millis));
  return `${monthShort(month)} ${day}, ${year}`;
}

/** Signed money text: "+₱100.00" or "−₱6.00". */
export function signedMoney(centavos: number): string {
  return centavos >= 0 ? '+' + formatMoney(centavos) : '−' + formatMoney(-centavos);
}

/** "Balance ₱26.00", "Owes ₱8.00" or "Settled". */
export function balanceText(centavos: number): string {
  if (centavos > 0) return 'Balance ' + formatMoney(centavos);
  if (centavos < 0) return 'Owes ' + formatMoney(-centavos);
  return 'Settled';
}

/** The signed-in officer's own balance in one line, such as "Your balance: ₱776.00" or "You owe ₱50.00". */
export function myBalanceLine(centavos: number): string {
  if (centavos < 0) return 'You owe ' + formatMoney(-centavos);
  if (centavos > 0) return 'Your balance: ' + formatMoney(centavos);
  return 'Your balance: settled';
}

/** The amount under a "Your balance" label: a plain amount when positive, otherwise "Owes ..." or "Settled". */
export function myBalanceValue(centavos: number): string {
  return centavos > 0 ? formatMoney(centavos) : balanceText(centavos);
}

const s = (n: number) => (n === 1 ? '' : 's');

// ---------------------------------------------------------------- Building blocks

/** A small mark for each record type, drawn on a 24 by 24 grid: plus, minus, an arrow out, and a bank note. */
const TYPE_MARKS: Record<RecordType, string[]> = {
  PAYMENT: ['M12 6v12', 'M6 12h12'],
  CHARGE: ['M6 12h12'],
  WITHDRAWAL: ['M7 17L17 7', 'M9 7h8v8'],
  EXPENSE: ['M3 7h18v10H3z', 'M12 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z'],
  OPENING: ['M6 12h12', 'M12 6v12'],
};

function TypeMark({ type, size }: { type: RecordType; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {TYPE_MARKS[type].map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** The record type as a soft circle in its color, for rows with no person (class charges and pay-outs). */
export function TypeIcon({ type, size = 40 }: { type: RecordType; size?: number }) {
  return (
    <span className="type-icon" style={{ '--c': recordColor(type), width: size, height: size } as CSSProperties}>
      <TypeMark type={type} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** A person's picture with the record type as a small badge on its corner. */
function AvatarWithType({ type, children }: { type: RecordType; children: ReactNode }) {
  return (
    <span className="avatar-typed">
      {children}
      <span className="type-dot" style={{ '--c': recordColor(type) } as CSSProperties} title={recordLabel(type)}>
        <TypeMark type={type} size={11} />
      </span>
    </span>
  );
}

/** An amount with a smaller peso sign, for the big numbers at the top of a card. */
function BigMoney({ centavos }: { centavos: number }) {
  const text = formatMoney(centavos);
  const sign = text.indexOf('₱');
  return (
    <div className="money-big">
      {text.slice(0, sign)}
      <span className="peso">₱</span>
      {text.slice(sign + 1)}
    </div>
  );
}

export function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span className="tag" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      {text}
    </span>
  );
}

/** One ledger line. Used on the Ledger tab and in "Recent" on Home. */
export function EntryRow({ entry, state, onClick, mine }: { entry: LedgerEntry; state: ClassState; onClick?: () => void; mine?: boolean }) {
  const paidOut = useMemo(() => Ledger.paidOutBatchIds(state.records), [state.records]);
  let title: string;
  let subtitle: string;
  const courseOf = (id: string) => state.courses.find((c) => c.id === id)?.name ?? '';
  // In a list of only the viewer's own records, their name on every row says nothing: the row leads with what it was for.
  const own = entry.kind === 'single' && entry.record.memberId === state.myUid && (!!mine || !state.seeAll);
  if (entry.kind === 'batch') {
    const each = entry.perMemberCentavos !== null ? ' × ' + formatMoney(entry.perMemberCentavos) : '';
    const course = courseOf(entry.courseId);
    title = entry.note.trim() || course || 'Charge';
    subtitle = `Charge · ${entry.count} student${s(entry.count)}${each}` + (course ? ` · ${course}` : '');
  } else {
    const r = entry.record;
    const withNote = (text: string) => text + (r.note.trim() ? ` · ${r.note}` : '');
    const course = courseOf(r.courseId);
    const note = r.note.trim();
    switch (own ? `OWN_${r.type}` : r.type) {
      case 'OWN_PAYMENT':
        [title, subtitle] = [note || 'Payment', 'Payment'];
        break;
      case 'OWN_WITHDRAWAL':
        [title, subtitle] = [note || 'Withdrawal', 'Withdrawal from balance'];
        break;
      case 'OWN_OPENING':
        [title, subtitle] = [note || 'Opening balance', 'Opening balance'];
        break;
      case 'OWN_CHARGE':
        [title, subtitle] = [note || course || 'Charge', 'Charge' + (note && course ? ` · ${course}` : '')];
        break;
      case 'PAYMENT':
        [title, subtitle] = [r.memberName, withNote('Payment')];
        break;
      case 'WITHDRAWAL':
        [title, subtitle] = [r.memberName, withNote('Withdrawal from balance')];
        break;
      case 'EXPENSE':
        [title, subtitle] = [r.note.trim() || 'Pay-out', 'Paid out from fund' + (r.paidTo.trim() ? ` to ${r.paidTo}` : '')];
        break;
      case 'OPENING':
        [title, subtitle] = [r.memberName, withNote('Opening balance')];
        break;
      default:
        [title, subtitle] = [note || course || 'Charge', `Charge · ${r.memberName}` + (note && course ? ` · ${course}` : '')];
    }
  }
  const amount = LedgerView.displayAmount(entry);
  const voided = entry.kind === 'batch' ? entry.voided : entry.record.voidedAtMillis > 0;
  const struck = voided ? { textDecoration: 'line-through', opacity: 0.6 } : undefined;
  const photoOwner = entry.kind === 'single' && entry.record.memberId && !own ? entry.record : null;
  const role = photoOwner ? state.roleOf(state.members.find((m) => m.id === photoOwner.memberId)) : null;
  const content = (
    <>
      {photoOwner ? (
        <AvatarWithType type={entry.type}>
          <Avatar photo={state.avatars.get(photoOwner.memberId)} name={photoOwner.memberName} color={hexColor(role?.colorHex, '#6B768A')} size={40} />
        </AvatarWithType>
      ) : (
        <TypeIcon type={entry.type} />
      )}
      <span className="grow ellipsis-box">
        <span className="title ellipsis" style={struck}>{title}</span>
        <span className="sub ellipsis">
          <CourseDot color={state.courses.find((c) => c.id === (entry.kind === 'batch' ? entry.courseId : entry.record.courseId))?.color} />
          {subtitle}
        </span>
      </span>
      <span className="end-col">
        <span className={'bold ' + (amount >= 0 ? 'income' : 'expense')} style={struck}>{signedMoney(amount)}</span>
        {voided && <Tag text="Voided" color="var(--error)" />}
        {!voided &&
          entry.kind === 'batch' &&
          (paidOut.has(entry.batchId) ? <Tag text="Paid out" color="var(--income)" /> : <Tag text="Not yet paid out" color="var(--pending)" />)}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="list-row" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="list-row">{content}</div>
  );
}

function SummaryTile({ label, centavos }: { label: string; centavos: number }) {
  return (
    <div className="summary-tile">
      <span className="small soft ellipsis">{label}</span>
      <span className="bold">{formatMoney(centavos)}</span>
    </div>
  );
}

/** The class fund: Cash on hand, Net collected, Charged to members, what is waiting to be paid out, and the books check. */
export function FundSummaryCard({ records, title }: { records: LedgerRecord[]; title?: string }) {
  const withdrawn = Ledger.total(records, 'WITHDRAWAL');
  const difference = Ledger.booksDifference(records);
  return (
    <div className="card hero">
      {title && <div className="bold" style={{ fontSize: 17, marginBottom: 6 }}>{title}</div>}
      <div className="soft">Cash on hand</div>
      <BigMoney centavos={Ledger.cashOnHand(records)} />
      <div className="tiles">
        <SummaryTile label="Net collected" centavos={Ledger.netCollected(records)} />
        <SummaryTile label="Charged to members" centavos={Ledger.total(records, 'CHARGE')} />
      </div>
      {withdrawn > 0 && (
        <div className="small soft" style={{ marginTop: 6 }}>
          {formatMoney(Ledger.total(records, 'PAYMENT'))} paid in, {formatMoney(withdrawn)} withdrawn.
        </div>
      )}
      <div className="tiles">
        <SummaryTile label="Waiting to be paid out" centavos={Ledger.awaitingPayout(records)} />
        <SummaryTile label="Available cash" centavos={Ledger.availableCash(records)} />
      </div>
      <div className="small semibold" style={{ marginTop: 10 }}>
        {difference === 0
          ? '✓ Books balanced'
          : `⚠ Books off by ${formatMoney(Math.abs(difference))}. A record may be missing or entered wrong.`}
      </div>
    </div>
  );
}

/** A member's own balance as the headline, with what they paid in and were charged. */
export function MyBalanceCard({ records, balanceCentavos, myUid }: { records: LedgerRecord[]; balanceCentavos: number; myUid: string }) {
  const mine = records.filter((r) => r.memberId === myUid);
  const owes = balanceCentavos < 0;
  const withdrawn = Ledger.total(mine, 'WITHDRAWAL');
  return (
    <div className={'card hero' + (owes ? ' hero-error' : '')}>
      <div className="soft">{owes ? 'You owe' : 'Your balance'}</div>
      <BigMoney centavos={owes ? -balanceCentavos : balanceCentavos} />
      <div className="small semibold">
        {owes ? 'Please settle it with your class officers.' : balanceCentavos > 0 ? 'Credit that will cover your next class charges.' : 'You are all settled.'}
      </div>
      <div className="tiles">
        <SummaryTile label="You paid in" centavos={Ledger.total(mine, 'PAYMENT')} />
        <SummaryTile label="Charged to you" centavos={Ledger.total(mine, 'CHARGE')} />
      </div>
      {withdrawn > 0 && (
        <div className="small soft" style={{ marginTop: 6 }}>
          You withdrew {formatMoney(withdrawn)} in total.
        </div>
      )}
    </div>
  );
}

/**
 * The ledger card at the top of Home and Ledger. Officers who manage the ledger see the class fund;
 * everyone else sees what matters to them: their own balance, or what they owe.
 */
export function LedgerSummaryCard({ state }: { state: ClassState }) {
  return state.can('RECORDS_MANAGE') ? (
    <FundSummaryCard records={state.records} />
  ) : (
    <>
      <MyBalanceCard records={state.records} balanceCentavos={state.balanceOf(state.myUid)} myUid={state.myUid} />
      {state.summary && (
        <div className="card">
          <div className="small semibold muted">Class fund</div>
          <div className="tiles">
            <SummaryTile label="Cash on hand" centavos={state.summary.cashOnHandCentavos} />
            <SummaryTile label="Waiting to be paid out" centavos={state.summary.waitingPayoutCentavos} />
          </div>
        </div>
      )}
      {state.room?.paymentInfo.trim() && (
        <div className="card">
          <div className="small semibold muted">How to pay</div>
          <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{state.room.paymentInfo}</p>
        </div>
      )}
    </>
  );
}

const VISIBILITY_LABELS: Record<BalanceVisibility, string> = {
  EVERYONE: 'The whole class',
  OFFICERS: 'Officers only',
  TREASURERS: 'Treasurers only',
};

/** Who may see every balance, and how to pay. Changed by anyone who manages the records. */
export function LedgerSettingsCard({ state, onSave }: { state: ClassState; onSave: (visibility: BalanceVisibility, paymentInfo: string) => void }) {
  const room = state.room;
  const [visibility, setVisibility] = useState<BalanceVisibility>(room?.balanceVisibility ?? 'EVERYONE');
  const [info, setInfo] = useState(room?.paymentInfo ?? '');
  const [open, setOpen] = useState(false);
  if (!room) return null;
  const changed = visibility !== room.balanceVisibility || info.trim() !== room.paymentInfo;
  return (
    <>
      <button type="button" className="btn outline" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Ledger settings
      </button>
      {open && (
        <Dialog
          title="Ledger settings"
          onClose={() => setOpen(false)}
          actions={
            <>
              <button className="btn text" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn solid" disabled={!changed} onClick={() => (onSave(visibility, info), setOpen(false))}>
                Save
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Who can see every balance" help="Everyone always sees their own records, the fund totals and the pay-outs. The Mayor and the treasurers always see everything.">
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as BalanceVisibility)}>
                {BALANCE_VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How to pay (shown to the class)">
              <textarea value={info} rows={3} maxLength={500} placeholder="e.g. GCash 09XX XXX XXXX, or cash to the treasurer" onChange={(e) => setInfo(e.target.value)} />
            </Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Ledger tab

export function LedgerTab({
  state,
  onDeleteRecord,
  onUndoCharge,
  onRecordPayout,
  onSaveSettings,
  extras,
}: {
  state: ClassState;
  /** Shown under the fund summary: the statement and the payment claims. */
  extras?: ReactNode;
  onSaveSettings: (visibility: BalanceVisibility, paymentInfo: string) => void;
  onDeleteRecord: (record: LedgerRecord, reason: string) => void;
  onUndoCharge: (batch: ChargeBatch, reason: string) => void;
  onRecordPayout: (batchId: string) => void;
}) {
  const [filter, setFilter] = useState<LedgerFilter>('ALL');
  const [selected, setSelected] = useState<LedgerEntry | null>(null);
  const entries = useMemo(() => LedgerView.filter(state.records, filter, state.myUid), [state.records, filter, state.myUid]);
  let lastHeader = '';

  return (
    <div className="ledger-tab">
      <div className="split">
        <div className="stack">
          <LedgerSummaryCard state={state} />
          {state.can('RECORDS_MANAGE') && <div className="semibold muted">{myBalanceLine(state.balanceOf(state.myUid))}</div>}
          {extras}
          {state.can('RECORDS_MANAGE') && <LedgerSettingsCard key={`${state.room?.balanceVisibility}|${state.room?.paymentInfo}`} state={state} onSave={onSaveSettings} />}
        </div>
        <div className="stack">
          <div className="chips" role="tablist" aria-label="Filter records">
            {LEDGER_FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={f.id === filter} className={'chip' + (f.id === filter ? ' selected' : '')} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="card flush">
            {entries.length === 0 && (
              <p className="empty">
                {state.records.length === 0 ? 'No records yet. Officers with the ledger permission can add one with the + button.' : 'Nothing here for this filter.'}
              </p>
            )}
            {entries.map((entry) => {
              const header = dayHeader(entry.dateMillis);
              const showHeader = header !== lastHeader;
              lastHeader = header;
              return (
                <div key={entry.key}>
                  {showHeader && <div className="section-label">{header}</div>}
                  <EntryRow entry={entry} state={state} mine={filter === 'MINE'} onClick={() => setSelected(entry)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <EntryDetailsDialog
          entry={selected}
          state={state}
          canManage={state.can('RECORDS_MANAGE')}
          onDismiss={() => setSelected(null)}
          onDelete={(record, reason) => (setSelected(null), onDeleteRecord(record, reason))}
          onUndo={(batch, reason) => (setSelected(null), onUndoCharge(batch, reason))}
          onRecordPayout={(batchId) => (setSelected(null), onRecordPayout(batchId))}
        />
      )}
    </div>
  );
}

function EntryDetailsDialog({
  entry,
  state,
  canManage,
  onDismiss,
  onDelete,
  onUndo,
  onRecordPayout,
}: {
  entry: LedgerEntry;
  state: ClassState;
  canManage: boolean;
  onDismiss: () => void;
  onDelete: (record: LedgerRecord, reason: string) => void;
  onUndo: (batch: ChargeBatch, reason: string) => void;
  onRecordPayout: (batchId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const voided = entry.kind === 'batch' ? entry.voided : entry.record.voidedAtMillis > 0;
  const createdBy = (uid: string) => state.members.find((m) => m.id === uid)?.name ?? 'a former member';
  const payout = entry.kind === 'batch' ? LedgerView.payoutFor(entry.batchId, state.records) : null;
  // A charge that was paid out cannot be undone, and a single student's share of a charge is not deleted on its own.
  const removable = !voided && (entry.kind === 'batch' || !(entry.record.type === 'CHARGE' && entry.record.batchId));

  if (confirming) {
    return (
      <Dialog
        title={entry.kind === 'batch' ? 'Void this whole charge?' : 'Void this record?'}
        onClose={onDismiss}
        actions={
          <>
            <button className="btn text" onClick={onDismiss}>
              Cancel
            </button>
            <button className="btn text danger" disabled={!reason.trim()} onClick={() => (entry.kind === 'batch' ? onUndo(entry, reason.trim()) : onDelete(entry.record, reason.trim()))}>
              {entry.kind === 'batch' ? 'Void charge' : 'Void record'}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {entry.kind === 'batch'
            ? `All ${entry.count} charges of "${entry.note}" stay in the list, crossed out, and the balances of those students go back up.` +
              (payout ? ' Its pay-out is voided as well.' : '')
            : 'The record stays in the list, crossed out, with your name and this reason. It is left out of every total. This cannot be undone.'}
        </p>
        <label className="small semibold muted" style={{ display: 'block', marginTop: 12 }}>
          Reason for voiding
          <textarea value={reason} maxLength={200} rows={2} style={{ display: 'block', width: '100%', marginTop: 4 }} onChange={(e) => setReason(e.target.value)} />
        </label>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={recordLabel(entry.type)}
      onClose={onDismiss}
      actions={
        <>
          {canManage && removable && (
            <button className="btn text danger" style={{ marginRight: 'auto' }} onClick={() => setConfirming(true)}>
              {entry.kind === 'batch' ? 'Void charge' : 'Void record'}
            </button>
          )}
          {canManage && !voided && entry.kind === 'batch' && payout === null && (
            <button className="btn text" onClick={() => onRecordPayout(entry.batchId)}>
              Record pay-out
            </button>
          )}
          <button className="btn text" onClick={onDismiss}>
            Close
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 6 }}>
        {voided && (
          <p className="error-text" style={{ margin: 0 }}>
            Voided
            {(() => {
              const r = entry.kind === 'batch' ? entry.records[0] : entry.record;
              return r ? ` by ${createdBy(r.voidedByUid)} on ${fullDate(r.voidedAtMillis)}: ${r.voidReason}` : '';
            })()}
          </p>
        )}
        {entry.kind === 'single' ? (
          <SingleDetails record={entry.record} state={state} createdBy={createdBy} />
        ) : (
          <>
            <DetailLine label="Description" value={entry.note} />
            {entry.perMemberCentavos !== null && <DetailLine label="Per student" value={formatMoney(entry.perMemberCentavos)} />}
            <DetailLine label="Students" value={String(entry.count)} />
            <DetailLine label="Total" value={formatMoney(entry.totalCentavos)} />
            {(() => {
              const course = state.courses.find((c) => c.id === entry.courseId);
              return course ? <DetailLine label="Course" value={course.name} /> : null;
            })()}
            <DetailLine label="Date" value={fullDate(entry.dateMillis)} />
            {entry.records[0]?.createdByUid && <DetailLine label="Recorded by" value={createdBy(entry.records[0].createdByUid)} />}
            <DetailLine
              label="Status"
              value={payout ? `Paid out ${fullDate(payout.dateMillis)}` + (payout.paidTo.trim() ? ` to ${payout.paidTo}` : '') : 'Not yet paid out'}
            />
            <hr className="divider" />
            <div className="bold">Charged</div>
            {entry.records.map((r) => (
              <div key={r.id} className="small">
                • {r.memberName}&nbsp;&nbsp;{formatMoney(r.amountCentavos)}
              </div>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}

function SingleDetails({ record: r, state, createdBy }: { record: LedgerRecord; state: ClassState; createdBy: (uid: string) => string }) {
  const charge = r.type === 'EXPENSE' ? LedgerView.chargeFor(r, state.records) : null;
  return (
    <>
      <DetailLine label="Amount" value={formatMoney(r.amountCentavos)} />
      {r.memberName.trim() && <DetailLine label="Member" value={r.memberName} />}
      {r.note.trim() && <DetailLine label={r.type === 'EXPENSE' ? 'For' : 'Note'} value={r.note} />}
      {r.paidTo.trim() && <DetailLine label="Paid to" value={r.paidTo} />}
      {r.type === 'EXPENSE' && <DetailLine label="Settles" value={charge ? `${charge.note} (${charge.count} students)` : 'A charge that no longer exists'} />}
      <DetailLine label="Date" value={fullDate(r.dateMillis)} />
      {r.createdByUid.trim() && <DetailLine label="Recorded by" value={createdBy(r.createdByUid)} />}
      {r.type === 'CHARGE' && r.batchId && (
        <p className="small muted" style={{ margin: 0 }}>
          This is one student's share of a charge. To remove it, undo the whole charge from the All filter.
        </p>
      )}
    </>
  );
}

/** The four kinds of record the + button offers. */
export function AddRecordChooser({ onPick, onDismiss }: { onPick: (type: RecordType) => void; onDismiss: () => void }) {
  const options: [RecordType, string][] = [
    ['PAYMENT', 'A student pays money in.'],
    ['CHARGE', 'Deduct an amount from each student, such as a quiz fee. You can charge by course.'],
    ['WITHDRAWAL', 'A student takes part of their balance out.'],
    ['EXPENSE', 'Pay a charge out in full, for example handing the quiz money to the professor.'],
    ['OPENING', 'What a student already had, or owed, before this class started using ClassHub.'],
  ];
  return (
    <Dialog
      title="New record"
      onClose={onDismiss}
      actions={
        <button className="btn text" onClick={onDismiss}>
          Cancel
        </button>
      }
    >
      {options.map(([type, description]) => (
        <button key={type} type="button" className="option-card" onClick={() => onPick(type)}>
          <TypeIcon type={type} />
          <span className="grow">
            <span className="bold" style={{ display: 'block' }}>{recordLabel(type)}</span>
            <span className="small muted">{description}</span>
          </span>
        </button>
      ))}
    </Dialog>
  );
}

/** Searchable list of members, showing each one's balance. */
export function MemberPickerDialog({ state, onPick, onDismiss }: { state: ClassState; onPick: (member: Member) => void; onDismiss: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = state.members.filter((m) => !q || m.name.toLowerCase().includes(q));
  return (
    <Dialog
      title="Choose a member"
      onClose={onDismiss}
      actions={
        <button className="btn text" onClick={onDismiss}>
          Cancel
        </button>
      }
    >
      <label className="field">
        <span>Search</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </label>
      <div className="scroll-list">
        {shown.map((m) => (
          <button key={m.id} type="button" className="list-row" onClick={() => onPick(m)}>
            <Avatar photo={state.avatars.get(m.id)} name={m.name} color="var(--accent, #0F766E)" size={30} />
            <span className="grow">{m.name}</span>
            <span className="small muted">{balanceText(state.balanceOf(m.id))}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

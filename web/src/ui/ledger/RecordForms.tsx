import { useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { newRecord, type RecordType } from '../../data/models';
import { ChargePlanner } from '../../domain/chargePlanner';
import { LedgerForms } from '../../domain/ledgerForms';
import { LedgerView } from '../../domain/ledgerView';
import { formatMoney, parsePesos } from '../../domain/money';
import { Avatar, DateField, Dialog, Field, PickerField, Spinner, Switch, useBack } from '../common';
import { useClass } from '../classroom/ClassContext';
import { NoAccess, SubPage } from '../classroom/SubPage';
import { balanceText, fullDate, MemberPickerDialog, recordLabel } from './LedgerUi';

const s = (n: number) => (n === 1 ? '' : 's');

function AmountField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <span className="with-prefix">
        <span className="prefix" aria-hidden>
          ₱
        </span>
        <input inputMode="decimal" value={value} autoComplete="off" onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 14))} />
      </span>
    </Field>
  );
}

/** /class/:classId/record/:type. EXPENSE opens the pay-out form; the others are a payment or a withdrawal. */
export function RecordRoute() {
  const { type } = useParams();
  const [params] = useSearchParams();
  if (type === 'EXPENSE') return <PayoutFormScreen preselectedBatchId={params.get('batch') ?? ''} />;
  return <RecordFormScreen type={type === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'PAYMENT'} />;
}

// ---------------------------------------------------------------- Payment, Withdrawal

function RecordFormScreen({ type }: { type: Extract<RecordType, 'PAYMENT' | 'WITHDRAWAL'> }) {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}?tab=LEDGER`);
  const [amountText, setAmountText] = useState('');
  const [memberId, setMemberId] = useState('');
  const [note, setNote] = useState('');
  const [dateMillis, setDateMillis] = useState(() => Date.now());
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state.can('RECORDS_MANAGE')) {
    return (
      <SubPage title={recordLabel(type)}>
        <NoAccess what="add ledger records" />
      </SubPage>
    );
  }

  const member = state.members.find((m) => m.id === memberId);
  const amount = parsePesos(amountText);

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = LedgerForms.checkRecord(type, amount, memberId, member ? state.balanceOf(member.id) : null);
    setError(problem);
    if (problem || amount === null) return;
    actions.addRecord(newRecord({ type, amountCentavos: amount, memberId, memberName: member?.name ?? '', note: note.trim(), dateMillis }), back);
  }

  return (
    <SubPage title={recordLabel(type)}>
      <form className="card stack" onSubmit={submit} noValidate>
        <p className="small muted" style={{ margin: 0 }}>
          {type === 'WITHDRAWAL'
            ? 'A student takes part of their balance out, like a savings account. It cannot be more than their balance.'
            : 'Money a student pays into the class fund. Adds to their balance.'}
        </p>
        <AmountField value={amountText} onChange={(v) => (setAmountText(v), setError(null))} label="Amount" />
        <PickerField
          label={type === 'PAYMENT' ? 'Who paid' : 'Who is withdrawing'}
          value={member?.name ?? null}
          onClick={() => setPicking(true)}
          supporting={member ? `Current ${balanceText(state.balanceOf(member.id)).toLowerCase()}` : undefined}
        />
        <DateField millis={dateMillis} onChange={setDateMillis} />
        <Field label="Note (optional)">
          <input
            value={note}
            placeholder={type === 'WITHDRAWAL' ? 'e.g. Asked for cash back' : 'e.g. October dues'}
            onChange={(e) => (setNote(e.target.value.slice(0, 80)), setError(null))}
          />
        </Field>
        {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn solid big block" type="submit" disabled={actions.busy}>
          {actions.busy ? <Spinner small /> : 'Save ' + recordLabel(type).toLowerCase()}
        </button>
      </form>
      {picking && <MemberPickerDialog state={state} onPick={(m) => (setMemberId(m.id), setPicking(false), setError(null))} onDismiss={() => setPicking(false)} />}
    </SubPage>
  );
}

// ---------------------------------------------------------------- Pay out from fund

/** Pays out one charge in full. preselectedBatchId comes from the charge's "Record pay-out" button. */
function PayoutFormScreen({ preselectedBatchId }: { preselectedBatchId: string }) {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}?tab=LEDGER`);
  const [batchId, setBatchId] = useState(preselectedBatchId);
  const [paidTo, setPaidTo] = useState('');
  const [dateMillis, setDateMillis] = useState(() => Date.now());
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unpaid = useMemo(() => LedgerView.unpaidCharges(state.records), [state.records]);

  if (!state.can('RECORDS_MANAGE')) {
    return (
      <SubPage title={recordLabel('EXPENSE')}>
        <NoAccess what="record pay-outs" />
      </SubPage>
    );
  }

  const charge = unpaid.find((c) => c.batchId === batchId) ?? null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = LedgerForms.checkPayout(charge, false);
    setError(problem);
    if (!problem) actions.addPayout(charge, paidTo, dateMillis, back);
  }

  return (
    <SubPage title={recordLabel('EXPENSE')}>
      <form className="card stack" onSubmit={submit} noValidate>
        <p className="small muted" style={{ margin: 0 }}>
          Every pay-out settles one charge, for exactly what was charged. To spend money on something new, charge the students first.
        </p>
        {unpaid.length === 0 ? (
          <p className="semibold" style={{ margin: '16px 0' }}>There are no charges waiting to be paid out.</p>
        ) : (
          <>
            <PickerField
              label="Charge being paid out"
              value={charge?.note ?? null}
              onClick={() => setPicking(true)}
              supporting={charge ? `${charge.count} student${s(charge.count)} · charged ${fullDate(charge.dateMillis)}` : undefined}
            />
            <Field label="Amount (the charge's total)">
              <input value={charge ? formatMoney(charge.totalCentavos) : ''} readOnly tabIndex={-1} />
            </Field>
            <Field label="Paid to (optional)">
              <input value={paidTo} placeholder="e.g. Prof. Santos" onChange={(e) => setPaidTo(e.target.value.slice(0, 60))} />
            </Field>
            <DateField millis={dateMillis} onChange={setDateMillis} />
            {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
            <button className="btn solid big block" type="submit" disabled={actions.busy}>
              {actions.busy ? <Spinner small /> : charge ? 'Pay out ' + formatMoney(charge.totalCentavos) : 'Pay out'}
            </button>
          </>
        )}
      </form>
      {picking && (
        <Dialog
          title="Waiting to be paid out"
          onClose={() => setPicking(false)}
          actions={
            <button className="btn text" onClick={() => setPicking(false)}>
              Cancel
            </button>
          }
        >
          <div className="scroll-list">
            {unpaid.map((c) => (
              <button key={c.batchId} type="button" className="list-row" onClick={() => (setBatchId(c.batchId), setPicking(false), setError(null))}>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>{c.note}</span>
                  <span className="sub">
                    {c.count} student{s(c.count)} · {fullDate(c.dateMillis)}
                  </span>
                </span>
                <span className="bold">{formatMoney(c.totalCentavos)}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </SubPage>
  );
}

// ---------------------------------------------------------------- Charge students

const WHOLE_CLASS = '';

/** /class/:classId/charge */
export function ChargeStudentsScreen() {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}?tab=LEDGER`);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [courseId, setCourseId] = useState(WHOLE_CLASS);
  const [payNow, setPayNow] = useState(false);
  const [paidTo, setPaidTo] = useState('');
  const [dateMillis, setDateMillis] = useState(() => Date.now());
  const [pickingCourse, setPickingCourse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleIds = useMemo(() => new Set(ChargePlanner.eligible(state.members, courseId).map((m) => m.id)), [state.members, courseId]);
  // The checklist starts from who takes the course and resets when the course changes.
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> } | null>(null);
  const selectionKey = `${courseId}:${state.members.length}`;
  const selected = selection?.key === selectionKey ? selection.ids : eligibleIds;
  const setSelected = (ids: Set<string>) => setSelection({ key: selectionKey, ids });

  if (!state.can('RECORDS_MANAGE')) {
    return (
      <SubPage title={recordLabel('CHARGE')}>
        <NoAccess what="charge students" />
      </SubPage>
    );
  }

  const perMember = parsePesos(amountText);
  const forceInclude = new Set([...selected].filter((id) => !eligibleIds.has(id)));
  const forceExclude = new Set([...eligibleIds].filter((id) => !selected.has(id)));
  const preview = ChargePlanner.preview(state.members, courseId, perMember ?? 0, forceInclude, forceExclude);
  const courseName = state.courses.find((c) => c.id === courseId)?.name ?? null;
  const n = preview.charged.length;

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = LedgerForms.checkCharge(perMember, note, n);
    setError(problem);
    if (!problem) actions.chargeStudents(preview, note, courseId, dateMillis, payNow, paidTo, back);
  }

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  return (
    <SubPage title={recordLabel('CHARGE')} wide>
      <div className="split">
        <form className="card stack" onSubmit={submit} noValidate>
          <p className="small muted" style={{ margin: 0 }}>
            Deducts the same amount from each chosen student's balance, like a quiz fee. Cash on hand does not change.
          </p>
          <AmountField value={amountText} onChange={(v) => (setAmountText(v), setError(null))} label="Amount per student" />
          <Field label="Description">
            <input value={note} placeholder="e.g. Quiz - Operations Research" onChange={(e) => (setNote(e.target.value.slice(0, 80)), setError(null))} />
          </Field>
          <PickerField
            label="Course"
            value={courseName ?? 'Whole class'}
            onClick={() => setPickingCourse(true)}
            supporting={courseName ? `Students who do not take ${courseName} are unticked.` : undefined}
          />
          <DateField millis={dateMillis} onChange={setDateMillis} />
          <Switch
            label="Also record the pay-out now"
            sub="Turn on if the money is being paid out today, for example handed to the professor."
            checked={payNow}
            onChange={setPayNow}
          />
          {payNow && (
            <Field label="Paid to (optional)">
              <input value={paidTo} placeholder="e.g. Prof. Santos" onChange={(e) => setPaidTo(e.target.value.slice(0, 60))} />
            </Field>
          )}
          <div className="note-card">
            <div className="bold" style={{ fontSize: 17 }}>
              {formatMoney(perMember ?? 0)} × {n} student{s(n)} = {formatMoney(preview.totalCentavos)}
            </div>
            {preview.skipped.length > 0 && (
              <div className="small muted">
                {preview.skipped.length} student{s(preview.skipped.length)} not charged
              </div>
            )}
          </div>
          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button className="btn solid big block" type="submit" disabled={actions.busy}>
            {actions.busy ? <Spinner small /> : `Charge ${n} student${s(n)}` + (payNow ? ' and pay out' : '')}
          </button>
        </form>

        <div className="card flush">
          <div className="row" style={{ padding: '0 8px 0 0' }}>
            <div className="section-label grow">Who is charged</div>
            <button type="button" className="btn text small" onClick={() => setSelected(new Set(state.members.map((m) => m.id)))}>
              All
            </button>
            <button type="button" className="btn text small" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
          {state.members.map((m) => {
            const checked = selected.has(m.id);
            return (
              <label key={m.id} className="list-row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" className="check" checked={checked} onChange={(e) => toggle(m.id, e.target.checked)} />
                <Avatar photo={state.avatars.get(m.id)} name={m.name} color="var(--accent, #0F766E)" size={30} />
                <span className="grow">
                  <span style={{ display: 'block' }}>{m.name}</span>
                  {!eligibleIds.has(m.id) && courseName && <span className="sub">Does not take {courseName}</span>}
                </span>
                <span className="small muted">{balanceText(state.balanceOf(m.id))}</span>
              </label>
            );
          })}
        </div>
      </div>

      {pickingCourse && (
        <Dialog
          title="Charge by course"
          onClose={() => setPickingCourse(false)}
          actions={
            <button className="btn text" onClick={() => setPickingCourse(false)}>
              Cancel
            </button>
          }
        >
          <div className="scroll-list">
            <button type="button" className="list-row" onClick={() => (setCourseId(WHOLE_CLASS), setPickingCourse(false))}>
              Whole class
            </button>
            {state.courses.map((c) => (
              <button key={c.id} type="button" className="list-row" onClick={() => (setCourseId(c.id), setPickingCourse(false))}>
                {c.name}
              </button>
            ))}
            {state.courses.length === 0 && <p className="small muted">No courses yet. Add them under Home → Courses.</p>}
          </div>
        </Dialog>
      )}
    </SubPage>
  );
}

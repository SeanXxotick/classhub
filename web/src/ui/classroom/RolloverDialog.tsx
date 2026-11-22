/*
 * Semester rollover ("Start a new semester"): a Mayor-only 3-step wizard inside Class settings that creates
 * a fresh class for next term carrying over all members, roles, optional closing balances (as OPENING records),
 * and optional payment settings, while keeping the current semester intact as an archive.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { rolloverClass } from '../../data/rollover';
import { ClassRules } from '../../domain/classRules';
import { formatMoney } from '../../domain/money';
import type { ClassRoom } from '../../data/models';
import { Dialog, Field, Spinner, Switch } from '../common';
import { useClass } from './ClassContext';

export function RolloverCard({ room }: { room: ClassRoom }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card stack">
      <div className="bold">New semester</div>
      <p className="small muted" style={{ margin: 0 }}>
        Start next semester in a fresh class with the same classmates, roles and carried-over balances. This class stays intact as an archive.
      </p>
      <button type="button" className="btn outline block" onClick={() => setOpen(true)}>
        Start a new semester
      </button>
      {open && <RolloverDialog room={room} onClose={() => setOpen(false)} />}
    </div>
  );
}

function RolloverDialog({ room, onClose }: { room: ClassRoom; onClose: () => void }) {
  const { state, actions } = useClass();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState('');
  const [carryBalances, setCarryBalances] = useState(true);
  const [carryPaymentSettings, setCarryPaymentSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceStats = useMemo(() => {
    let count = 0;
    let net = 0;
    for (const m of state.members) {
      const b = state.balanceOf(m.id);
      if (b !== 0) {
        count++;
        net += b;
      }
    }
    return { count, net };
  }, [state]);

  const nameError = ClassRules.checkName(name);

  async function create() {
    if (busy || nameError) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rolloverClass(
        db,
        state.myUid,
        { room, roles: state.roles, members: state.members, balances: state.balances },
        { name, description, carryBalances, carryPaymentSettings },
      );
      actions.showNotice(`Created ${name.trim()} with ${result.copiedMembers} members.`);
      onClose();
      navigate(`/class/${result.classId}`, { replace: true });
    } catch (e) {
      setError(friendlyMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Start a new semester (${step} of 3)`}
      onClose={busy ? () => undefined : onClose}
      actions={
        step === 1 ? (
          <>
            <button type="button" className="btn text" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn solid" disabled={nameError !== null} onClick={() => setStep(2)}>
              Next
            </button>
          </>
        ) : step === 2 ? (
          <>
            <button type="button" className="btn text" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn solid" onClick={() => setStep(3)}>
              Next
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn text" disabled={busy} onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" className="btn solid" disabled={busy} onClick={() => void create()}>
              {busy ? <Spinner small /> : 'Create new class'}
            </button>
          </>
        )
      }
    >
      {step === 1 && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            Your current class ({room.name}) stays untouched for reference. Nothing is deleted.
          </p>
          <Field label="Class name" help={nameError ? <span className="error-text">{nameError}</span> : undefined}>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, ClassRules.MAX_NAME))} />
          </Field>
          <Field label="Term or description (optional)">
            <input
              value={description}
              placeholder="e.g. 2nd Semester, AY 2026-2027"
              onChange={(e) => setDescription(e.target.value.slice(0, ClassRules.MAX_DESCRIPTION))}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <Switch
            label={`All ${state.members.length} members and ${state.roles.length} roles`}
            sub="Everyone joins automatically with their current role — no invite code needed."
            checked
            disabled
            onChange={() => undefined}
          />
          <Switch
            label="Carry over closing balances"
            sub={
              balanceStats.count > 0
                ? `${balanceStats.count} student${balanceStats.count === 1 ? '' : 's'} with non-zero balances (net ${formatMoney(balanceStats.net)}) start as Opening Balances.`
                : 'Everyone is currently settled at ₱0.00.'
            }
            checked={carryBalances}
            onChange={setCarryBalances}
          />
          <Switch
            label='Copy "How to pay" & balance visibility'
            sub="Keeps your payment instructions and who can see balances."
            checked={carryPaymentSettings}
            onChange={setCarryPaymentSettings}
          />
          <p className="small muted" style={{ margin: 0 }}>
            Starts fresh: Courses, Weekly timetable, Attendance, Schedule, Contents, and News.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <p className="semibold" style={{ margin: 0 }}>
            {name.trim()}
            {description.trim() ? ` · ${description.trim()}` : ''}
          </p>
          <div className="card flush" style={{ padding: '6px 0' }}>
            <div className="list-row">
              <span className="grow muted">Members &amp; roles</span>
              <span className="bold">{`${state.members.length} members, ${state.roles.length} roles`}</span>
            </div>
            <div className="list-row">
              <span className="grow muted">Opening balances</span>
              <span className="bold">
                {carryBalances && balanceStats.count > 0 ? `${balanceStats.count} carried over` : 'Start at ₱0.00'}
              </span>
            </div>
            <div className="list-row">
              <span className="grow muted">Payment settings</span>
              <span className="bold">{carryPaymentSettings ? 'Copied' : 'Default'}</span>
            </div>
            <div className="list-row">
              <span className="grow muted">Old class</span>
              <span className="bold">Kept as archive</span>
            </div>
          </div>
          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

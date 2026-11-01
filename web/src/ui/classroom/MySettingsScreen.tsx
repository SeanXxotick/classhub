import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClassRoom, Member } from '../../data/models';
import { MemberRules } from '../../domain/classRules';
import { formatMoney } from '../../domain/money';
import { Dialog, Switch } from '../common';
import { pinnedClasses, setPinned, setStartTab, startTab, useSettingsVersion } from '../settings';
import { useClass } from './ClassContext';
import { CLASS_TABS, tabShownIn } from './classTabs';
import { SubPage } from './SubPage';

/**
 * A member's own settings for one class: which tab it opens on and whether it is pinned in
 * My classes (saved in this browser only; nobody else sees them). Leaving the class is here too.
 * The Android reminder switches are left out: the web app does not send reminders.
 */
export function MySettingsScreen() {
  const { state, actions } = useClass();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  useSettingsVersion();
  const room = state.room;

  return (
    <SubPage title="My settings">
      {room && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            These settings are only for you, in this browser. Nobody else in {room.name} sees or changes them.
          </p>

          <div className="card">
            <div className="bold" style={{ marginBottom: 4 }}>Open this class on</div>
            <div role="radiogroup" aria-label="Open this class on">
              {(() => {
                const tabs = CLASS_TABS.filter((t) => tabShownIn(t.id, room));
                const current = tabs.find((t) => t.id === startTab(state.classId))?.id ?? 'HOME';
                return tabs.map((tab) => (
                  <label key={tab.id} className="radio-row">
                    <input type="radio" name="start-tab" checked={tab.id === current} onChange={() => setStartTab(state.classId, tab.id)} />
                    {tab.label}
                  </label>
                ));
              })()}
            </div>
          </div>

          <div className="card">
            <div className="bold">My classes list</div>
            <Switch
              label="Pin to the top"
              sub={`Show ${room.name} first in My classes.`}
              checked={pinnedClasses().has(state.classId)}
              onChange={(on) => setPinned(state.classId, on)}
            />
          </div>

          <button className="btn outline danger block" disabled={actions.busy} onClick={() => setLeaving(true)}>
            Leave class
          </button>
        </div>
      )}

      {leaving && room && (
        <LeaveDialog
          room={room}
          onDismiss={() => setLeaving(false)}
          onLeave={(newMayorUid) => {
            setLeaving(false);
            actions.leaveClass(newMayorUid, () => {
              setPinned(state.classId, false);
              actions.showNotice(`You left ${room.name}.`);
              navigate('/', { replace: true });
            });
          }}
        />
      )}
    </SubPage>
  );
}

function LeaveDialog({ room, onDismiss, onLeave }: { room: ClassRoom; onDismiss: () => void; onLeave: (newMayorUid: string | null) => void }) {
  const { state } = useClass();
  if (MemberRules.mustHandOver(state.myUid, room.ownerUid)) {
    return (
      <HandOverDialog
        className={room.name}
        candidates={MemberRules.mayorCandidates(state.myUid, state.members)}
        onConfirm={(m) => onLeave(m.id)}
        onDismiss={onDismiss}
      />
    );
  }
  const balance = room.ledgerEnabled ? state.balanceOf(state.myUid) : 0;
  return (
    <Dialog
      title={`Leave ${room.name}?`}
      onClose={onDismiss}
      actions={
        <>
          <button className="btn text" onClick={onDismiss}>
            Cancel
          </button>
          <button className="btn text danger" onClick={() => onLeave(null)}>
            Leave
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>The class will disappear from My classes. To come back, you will need a new invite code.</p>
      <p style={{ margin: 0 }}>Your ledger records stay with the class, as part of its history.</p>
      {balance < 0 && (
        <p className="error-text semibold" style={{ margin: 0 }}>
          You still owe {formatMoney(-balance)}. Please settle it with your class officers.
        </p>
      )}
      {balance > 0 && (
        <p className="semibold" style={{ margin: 0 }}>
          You have {formatMoney(balance)} left in the class fund. Ask your class officers about getting it back before you leave.
        </p>
      )}
    </Dialog>
  );
}

/**
 * The Mayor picks who takes over, then confirms. Both happen in one step with leaving,
 * so the class is never without a Mayor.
 */
function HandOverDialog({ className, candidates, onConfirm, onDismiss }: { className: string; candidates: Member[]; onConfirm: (m: Member) => void; onDismiss: () => void }) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const chosen = candidates.find((m) => m.id === chosenId);

  if (candidates.length === 0) {
    return (
      <Dialog
        title="You cannot leave yet"
        onClose={onDismiss}
        actions={
          <button className="btn text" onClick={onDismiss}>
            OK
          </button>
        }
      >
        <p style={{ margin: 0 }}>You are the only member of {className}. Invite someone and make them the Mayor before you leave.</p>
      </Dialog>
    );
  }
  if (confirming && chosen) {
    return (
      <Dialog
        title={`Make ${chosen.name} the Mayor and leave?`}
        onClose={onDismiss}
        actions={
          <>
            <button className="btn text" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn text danger" onClick={() => onConfirm(chosen)}>
              Make Mayor and leave
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {chosen.name} becomes the Mayor of {className}, with every permission. You then leave the class. Only the new Mayor can undo this by inviting you back.
        </p>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Choose the new Mayor"
      onClose={onDismiss}
      actions={
        <>
          <button className="btn text" onClick={onDismiss}>
            Cancel
          </button>
          <button className="btn text" disabled={!chosen} onClick={() => setConfirming(true)}>
            Next
          </button>
        </>
      }
    >
      <p className="small muted" style={{ margin: 0 }}>You are the Mayor, so someone has to take over before you leave.</p>
      <div className="scroll-list" role="radiogroup" aria-label="New Mayor">
        {candidates.map((m) => (
          <label key={m.id} className="radio-row">
            <input type="radio" name="new-mayor" checked={m.id === chosenId} onChange={() => setChosenId(m.id)} />
            {m.name}
          </label>
        ))}
      </div>
    </Dialog>
  );
}

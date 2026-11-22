import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { useSeen } from '../../data/features';
import { setHideFromBoard } from '../../data/forum';
import type { ClassRoom, Member } from '../../data/models';
import { MemberRules } from '../../domain/classRules';
import { formatMoney } from '../../domain/money';
import { Card, FilterChips, ListRow, SegmentedControl, TypeIcon, type IconName } from '../../design';
import { ACCENT_CHOICES, Avatar, ColorPicker, CourseDot, Dialog, RoleChip, Switch, hexColor } from '../common';
import {
  ledgerStartsOnMine,
  myAccent,
  pinnedClasses,
  setLedgerStartsOnMine,
  setMyAccent,
  setPinned,
  setStartTab,
  setViewAsMember,
  startTab,
  useSettingsVersion,
} from '../settings';
import { useClass } from './ClassContext';
import { CLASS_TABS, tabShownIn } from './classTabs';
import { InviteDialog } from './InviteDialog';
import { SubPage } from './SubPage';

/**
 * A member's own settings for one class: who they are in it, which tab it opens on, the Ledger's first filter,
 * their own accent color, pinning and the Top helpers opt-out. All but the opt-out stay in this browser.
 * Officers also get shortcuts to the class's manage screens. Leaving the class is at the bottom.
 */
export function MySettingsScreen() {
  const { state, actions } = useClass();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  useSettingsVersion();
  const room = state.room;
  const base = `/class/${state.classId}`;
  const forumOn = room?.announcementsEnabled !== false;
  const seen = useSeen(db, state.classId, forumOn).data ?? [];
  const leftOut = seen.find((s) => s.id === state.myUid)?.hideFromBoard ?? false;

  if (!room) return <SubPage title="My settings">{null}</SubPage>;

  const tabs = CLASS_TABS.filter((t) => tabShownIn(t.id, room));
  const current = tabs.find((t) => t.id === startTab(state.classId))?.id ?? 'HOME';
  const taken = state.courses.filter((c) => state.takes(c.id));
  const own = myAccent(state.classId);
  const roleName = state.myRole?.name ?? 'Member';

  const shortcuts: { icon: IconName; label: string; go: () => void }[] = [];
  if (state.can('CLASS_SETTINGS')) shortcuts.push({ icon: 'sliders', label: 'Class settings', go: () => navigate(`${base}/settings`) });
  if (state.can('CLASS_SETTINGS')) shortcuts.push({ icon: 'book', label: `Courses (${state.courses.length})`, go: () => navigate(`${base}/courses`) });
  if (state.can('ROLES_MANAGE')) shortcuts.push({ icon: 'shield', label: `Roles (${state.roles.length})`, go: () => navigate(`${base}/roles`) });
  if (state.can('CLASS_SETTINGS')) shortcuts.push({ icon: 'clock', label: 'History log', go: () => navigate(`${base}/history`) });
  if (state.can('MEMBERS_MANAGE')) shortcuts.push({ icon: 'key', label: 'Invite code', go: () => setInviting(true) });

  const toggleLeftOut = async (v: boolean) => {
    try {
      await setHideFromBoard(db, state.classId, state.myUid, v);
      actions.showNotice(v ? 'You are left out of Top helpers.' : 'You are back on Top helpers.');
    } catch (e) {
      actions.showNotice(friendlyMessage(e));
    }
  };

  return (
    <SubPage title="My settings">
      <div className="stack">
        <Card flush>
          <ListRow
            leading={<Avatar photo={state.avatars.get(state.myUid)} name={state.me?.name ?? 'You'} color="var(--accent, #0F766E)" size={44} />}
            title={room.name}
            subtitle={<RoleChip name={roleName} color={state.myRole?.colorHex ?? '#6B768A'} />}
            trailing={
              room.ledgerEnabled !== false ? (
                <button type="button" className="btn text" onClick={() => navigate(`${base}?tab=LEDGER`)}>
                  My statement
                </button>
              ) : undefined
            }
          />
          {state.courses.length > 0 && (
            <ListRow
              leading={<TypeIcon icon="book" tone="primary" />}
              title="My courses"
              subtitle={taken.length === state.courses.length ? `All ${state.courses.length}` : `${taken.length} of ${state.courses.length}`}
              chevron
              onClick={() => navigate(`${base}/mine/courses`)}
            />
          )}
        </Card>

        <div className="card stack">
          <div className="bold">Open this class on</div>
          <FilterChips label="Open this class on" value={current} onChange={(tab) => setStartTab(state.classId, tab)} options={tabs.map((t) => ({ value: t.id, label: t.label }))} />
          {room.ledgerEnabled !== false && (
            <div className="row">
              <span className="grow">Ledger shows</span>
              <SegmentedControl
                label="Ledger shows"
                value={ledgerStartsOnMine(state.classId) ? 'MINE' : 'ALL'}
                onChange={(v) => setLedgerStartsOnMine(state.classId, v === 'MINE')}
                options={[
                  { value: 'ALL', label: 'All' },
                  { value: 'MINE', label: 'Mine' },
                ]}
              />
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="row">
            <span className="bold grow">Color on this device</span>
            {own && (
              <button type="button" className="btn text small" onClick={() => setMyAccent(state.classId, null)}>
                Use class color
              </button>
            )}
          </div>
          <ColorPicker
            label="Color on this device"
            choices={[...new Set([hexColor(room.accentColor), ...ACCENT_CHOICES].map((h) => h.toUpperCase()))]}
            selected={hexColor(own ?? room.accentColor)}
            onSelect={(hex) => setMyAccent(state.classId, hex.toLowerCase() === hexColor(room.accentColor).toLowerCase() ? null : hex)}
            custom
          />
        </div>

        <div className="card">
          <Switch label="Pin to the top" sub={`Show ${room.name} first in My classes.`} checked={pinnedClasses().has(state.classId)} onChange={(on) => setPinned(state.classId, on)} />
          {forumOn && <Switch label="Leave me out of Top helpers" checked={leftOut} onChange={toggleLeftOut} />}
          {state.isOfficer && (
            <Switch
              label="View as member"
              sub="Temporarily hide officer tools on this device to preview the student view."
              checked={state.previewAsMember}
              onChange={(on) => setViewAsMember(state.classId, on)}
            />
          )}
        </div>

        {shortcuts.length > 0 && (
          <Card flush>
            <div className="section-label">Manage this class</div>
            {shortcuts.map((s) => (
              <ListRow key={s.label} leading={<TypeIcon icon={s.icon} tone="primary" />} title={s.label} chevron onClick={s.go} />
            ))}
          </Card>
        )}

        <button className="btn outline danger block" disabled={actions.busy} onClick={() => setLeaving(true)}>
          Leave class
        </button>
      </div>

      {inviting && (
        <InviteDialog
          className={room.name}
          code={room.inviteCode}
          roleName={state.roles.find((r) => r.id === room.defaultRoleId)?.name ?? 'Member'}
          notify={actions.showNotice}
          onClose={() => setInviting(false)}
        />
      )}

      {leaving && (
        <LeaveDialog
          room={room}
          onDismiss={() => setLeaving(false)}
          onLeave={(newMayorUid) => {
            setLeaving(false);
            actions.leaveClass(newMayorUid, () => {
              setPinned(state.classId, false);
              setMyAccent(state.classId, null);
              actions.showNotice(`You left ${room.name}.`);
              navigate('/', { replace: true });
            });
          }}
        />
      )}
    </SubPage>
  );
}

/** The courses this member takes and skips. Officers who manage members set these, so it only shows them. */
export function MyCoursesScreen() {
  const { state } = useClass();
  const taken = state.courses.filter((c) => state.takes(c.id));
  const skipped = state.courses.filter((c) => !state.takes(c.id));
  return (
    <SubPage title="My courses">
      <div className="stack">
        {state.courses.length === 0 && <p className="empty">This class has no courses yet.</p>}
        {taken.length > 0 && (
          <Card flush>
            <div className="section-label">You take {taken.length}</div>
            {taken.map((c) => (
              <ListRow key={c.id} leading={<CourseDot color={c.color || 'var(--accent)'} />} title={c.name} />
            ))}
          </Card>
        )}
        {skipped.length > 0 && (
          <Card flush>
            <div className="section-label">You do not take {skipped.length}</div>
            {skipped.map((c) => (
              <ListRow key={c.id} leading={<CourseDot color={c.color || 'var(--accent)'} />} title={c.name} subtitle="Hidden from your Schedule and Contents" />
            ))}
          </Card>
        )}
        {state.courses.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Your officers set this. Ask them if it is wrong.
          </p>
        )}
      </div>
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
      <p style={{ margin: 0 }}>The class will disappear from My classes. To come back, you will need the invite code.</p>
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
        <p style={{ margin: 0 }}>You are the only member of {className}. Invite someone and make them the Mayor before you leave, or delete the class in Class settings.</p>
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

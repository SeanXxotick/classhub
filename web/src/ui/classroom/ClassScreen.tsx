import { useEffect, useState, type CSSProperties } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Member, ScheduleItem } from '../../data/models';
import { JoinLinks } from '../../domain/joinLinks';
import { LedgerView } from '../../domain/ledgerView';
import { ScheduleView } from '../../domain/scheduleView';
import type { DayKey } from '../../domain/dates';
import { Avatar, ConfirmDialog, Icon, Loading, RoleChip, TopBar, hexColor } from '../common';
import { setPinned, startTab, useSettingsVersion } from '../settings';
import { ContentFormScreen, ContentsTab } from '../contents/ContentsUi';
import { AddRecordChooser, balanceText, EntryRow, LedgerSummaryCard, LedgerTab, myBalanceValue } from '../ledger/LedgerUi';
import { ChargeStudentsScreen, RecordRoute } from '../ledger/RecordForms';
import { monthDay, ScheduleFormScreen, ScheduleRow, ScheduleTab } from '../schedule/ScheduleUi';
import { ClassProvider, useClass, type ClassState } from './ClassContext';
import { CLASS_TABS, tabShownIn, type ClassTabId } from './classTabs';
import { ClassSettingsScreen, CoursesScreen, MemberDetailScreen, RoleEditorScreen, RolesScreen } from './ManageScreens';
import { MySettingsScreen } from './MySettingsScreen';

const s = (n: number) => (n === 1 ? '' : 's');

/** /class/:classId/* : keeps the class live for every screen inside it, in the class's accent color. */
export function ClassRoute({ uid }: { uid: string }) {
  const { classId = '' } = useParams();
  return (
    <ClassProvider key={classId} classId={classId} uid={uid}>
      <ClassFrame />
    </ClassProvider>
  );
}

function ClassFrame() {
  const { state, actions } = useClass();
  const navigate = useNavigate();

  // Removed from the class, or the class was deleted: forget it and go back to My classes.
  useEffect(() => {
    if (!state.removed) return;
    actions.forgetClass();
    setPinned(state.classId, false);
    navigate('/', { replace: true });
  }, [state.removed, state.classId, actions, navigate]);

  // The browser tab shows the class's name.
  const roomName = state.room?.name;
  useEffect(() => {
    if (!roomName) return;
    document.title = `${roomName} · ClassHub`;
    return () => {
      document.title = 'ClassHub';
    };
  }, [roomName]);

  return (
    <div className="accented class-frame" style={{ '--accent': hexColor(state.room?.accentColor) } as CSSProperties}>
      <Routes>
        <Route index element={<ClassScreen />} />
        <Route path="member/:memberId" element={<MemberDetailScreen />} />
        <Route path="roles" element={<RolesScreen />} />
        <Route path="roles/:roleId" element={<RoleEditorScreen />} />
        <Route path="courses" element={<CoursesScreen />} />
        <Route path="settings" element={<ClassSettingsScreen />} />
        <Route path="mine" element={<MySettingsScreen />} />
        <Route path="record/:type" element={<RecordRoute />} />
        <Route path="charge" element={<ChargeStudentsScreen />} />
        <Route path="content/:contentId" element={<ContentFormScreen />} />
        <Route path="schedule/:itemId" element={<ScheduleFormScreen />} />
        <Route path="*" element={<ClassScreen />} />
      </Routes>
    </div>
  );
}

function ClassScreen() {
  const { state, actions } = useClass();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [choosingRecord, setChoosingRecord] = useState(false);
  useSettingsVersion();
  const room = state.room;
  const base = `/class/${state.classId}`;

  // Opens on the tab chosen in My settings (Home if none, or if that tab was turned off).
  const tabs = CLASS_TABS.filter((t) => tabShownIn(t.id, room));
  const wanted = params.get('tab') ?? startTab(state.classId) ?? 'HOME';
  const tab: ClassTabId = tabs.find((t) => t.id === wanted)?.id ?? 'HOME';
  // The day picked in the schedule's week strip; adding a schedule item starts on it.
  const dayParam = params.get('day');
  const scheduleDay: DayKey | null = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;

  const setTab = (id: ClassTabId) => setParams(id === 'HOME' && !startTab(state.classId) ? {} : { tab: id }, { replace: true });
  const setScheduleDay = (day: DayKey | null) => setParams(day ? { tab: 'SCHEDULE', day } : { tab: 'SCHEDULE' }, { replace: true });

  const onToggleDone = (item: ScheduleItem, done: boolean) => actions.setDone(item, done);

  let fab: { label: string; onClick: () => void } | null = null;
  if (tab === 'LEDGER' && state.can('RECORDS_MANAGE')) fab = { label: '+  New record', onClick: () => setChoosingRecord(true) };
  if (tab === 'SCHEDULE' && state.can('SCHEDULE_MANAGE')) {
    fab = {
      label: scheduleDay ? `+  Add on ${monthDay(scheduleDay)}` : '+  Add',
      onClick: () => navigate(`${base}/schedule/new` + (scheduleDay ? `?day=${scheduleDay}` : '')),
    };
  }
  if (tab === 'CONTENTS' && state.can('CONTENTS_MANAGE')) fab = { label: '+  Add content', onClick: () => navigate(`${base}/content/new`) };

  return (
    <>
      <TopBar
        title={room?.name ?? ''}
        back={() => navigate('/')}
        backLabel="Classes"
        actions={
          room && (
            <button className="icon-btn" title="My settings for this class" aria-label="My settings for this class" onClick={() => navigate(`${base}/mine`)}>
              <Icon name="ic_my_settings" />
            </button>
          )
        }
      />
      <div className="page">
        {room && !state.loading && (
          <nav className="tabs wide-only" aria-label="Class sections">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={'tab' + (t.id === tab ? ' selected' : '')} aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={20} />
                {t.label}
              </button>
            ))}
          </nav>
        )}
        {state.loading ? (
          <Loading />
        ) : state.error ? (
          <p className="error-text center" style={{ padding: 32 }}>{state.error}</p>
        ) : !room || !state.me ? null : tab === 'HOME' ? (
          <HomeTab state={state} onSeeLedger={() => setTab('LEDGER')} onSeeSchedule={() => setTab('SCHEDULE')} onToggleDone={onToggleDone} />
        ) : tab === 'MEMBERS' ? (
          <MembersTab state={state} onOpenMember={(id) => navigate(`${base}/member/${id}`)} />
        ) : tab === 'LEDGER' ? (
          <LedgerTab
            state={state}
            onDeleteRecord={actions.deleteRecord}
            onUndoCharge={actions.undoCharge}
            onRecordPayout={(batchId) => navigate(`${base}/record/EXPENSE?batch=${encodeURIComponent(batchId)}`)}
          />
        ) : tab === 'SCHEDULE' ? (
          <ScheduleTab
            state={state}
            selectedDay={scheduleDay}
            onSelectDay={setScheduleDay}
            onEdit={(id) => navigate(`${base}/schedule/${id}`)}
            onToggleDone={onToggleDone}
            onSetCancelled={actions.setCancelled}
          />
        ) : (
          <ContentsTab state={state} onEdit={(id) => navigate(`${base}/content/${id}`)} onError={actions.showNotice} />
        )}
      </div>

      {fab && (
        <button className="btn solid fab" onClick={fab.onClick}>
          {fab.label}
        </button>
      )}

      {room && (
        <nav className="bottom-nav phone-only" aria-label="Class sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={t.id === tab ? 'selected' : ''} aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <span className="nav-icon">
                <Icon name={t.icon} size={24} />
              </span>
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {choosingRecord && (
        <AddRecordChooser
          onPick={(type) => {
            setChoosingRecord(false);
            navigate(type === 'CHARGE' ? `${base}/charge` : `${base}/record/${type}`);
          }}
          onDismiss={() => setChoosingRecord(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- Home

function HomeTab({
  state,
  onSeeLedger,
  onSeeSchedule,
  onToggleDone,
}: {
  state: ClassState;
  onSeeLedger: () => void;
  onSeeSchedule: () => void;
  onToggleDone: (item: ScheduleItem, done: boolean) => void;
}) {
  const { actions } = useClass();
  const navigate = useNavigate();
  const [confirmNewCode, setConfirmNewCode] = useState(false);
  const room = state.room!;
  const base = `/class/${state.classId}`;
  const canRoles = state.can('ROLES_MANAGE');
  const canCourses = state.can('CLASS_SETTINGS');
  const now = Date.now();
  const upcoming = ScheduleView.filter(state.schedule, 'UPCOMING', now, state.myDone).slice(0, 3);
  const overdue = ScheduleView.filter(state.schedule, 'OVERDUE', now, state.myDone).length;
  const ledgerOfficer = state.can('RECORDS_MANAGE');
  const recent = LedgerView.entries(state.records).slice(0, 3);
  const defaultRoleName = state.roles.find((r) => r.id === room.defaultRoleId)?.name ?? 'Member';

  async function shareCode() {
    const text = JoinLinks.shareText(room.name, room.inviteCode);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Share invite code', text });
        return;
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      actions.showNotice('The invite message was copied. Paste it in your class group chat.');
    } catch {
      actions.showNotice(`Share this link: ${JoinLinks.linkFor(room.inviteCode)}`);
    }
  }

  return (
    <div className="home-grid">
      <div className="stack">
        <div className="card hero">
          <div className="row">
            {state.classPhoto && <Avatar photo={state.classPhoto} name={room.name} color="var(--accent, #0F766E)" size={52} circle={false} />}
            <span>
              <span style={{ display: 'block', fontSize: 24, fontWeight: 700 }}>{room.name}</span>
              {room.description.trim() && <span className="soft">{room.description}</span>}
            </span>
          </div>
          <div className="semibold" style={{ marginTop: 10 }}>
            {state.members.length} member{s(state.members.length)}&nbsp;&nbsp;·&nbsp;&nbsp;You are {state.myRole?.name ?? 'a member'}
          </div>
        </div>

        {(canRoles || canCourses) && (
          <div className="card stack" style={{ gap: 10 }}>
            <div>
              <div className="bold">Manage</div>
              <div className="small muted">Officer roles, the courses your class takes, and class settings.</div>
            </div>
            <div className="row wrap">
              {canRoles && (
                <button className="btn outline" onClick={() => navigate(`${base}/roles`)}>
                  Roles ({state.roles.length})
                </button>
              )}
              {canCourses && (
                <button className="btn outline" onClick={() => navigate(`${base}/courses`)}>
                  Courses ({state.courses.length})
                </button>
              )}
            </div>
            {canCourses && (
              <button className="btn outline block" onClick={() => navigate(`${base}/settings`)}>
                Class settings
              </button>
            )}
          </div>
        )}

        {room.scheduleEnabled && (
          <div className="card flush">
            <div className="row" style={{ padding: '0 8px 0 16px' }}>
              <span className="grow">
                <span className="bold" style={{ display: 'block', fontSize: 17 }}>Coming up</span>
                {overdue > 0 && (
                  <span className="small semibold error-text">
                    {overdue} overdue item{s(overdue)}
                  </span>
                )}
              </span>
              <button className="btn text" onClick={onSeeSchedule}>
                Schedule ›
              </button>
            </div>
            {upcoming.length === 0 && <p className="muted" style={{ margin: 0, padding: '4px 16px' }}>Nothing due soon. You are all caught up.</p>}
            {upcoming.map((item) => (
              <ScheduleRow key={item.id} item={item} state={state} now={now} showDate onToggleDone={onToggleDone} />
            ))}
          </div>
        )}
      </div>

      <div className="stack">
        {room.ledgerEnabled && (
          <>
            <LedgerSummaryCard state={state} />
            <div className="card flush">
              <div className="row" style={{ padding: '0 8px 0 16px' }}>
                <span className="grow">
                  {ledgerOfficer ? (
                    <>
                      {/* Officers see the class fund above, so their own balance goes here. */}
                      <span className="small muted" style={{ display: 'block' }}>Your balance</span>
                      <span className="bold" style={{ fontSize: 17 }}>{myBalanceValue(state.balanceOf(state.myUid))}</span>
                    </>
                  ) : (
                    <span className="bold" style={{ fontSize: 17 }}>Class ledger</span>
                  )}
                </span>
                <button className="btn text" onClick={onSeeLedger}>
                  Ledger ›
                </button>
              </div>
              {recent.length > 0 && (
                <>
                  <div className="section-label">Recent</div>
                  {recent.map((entry) => (
                    <EntryRow key={entry.key} entry={entry} state={state} />
                  ))}
                </>
              )}
            </div>
          </>
        )}

        {state.can('MEMBERS_MANAGE') && (
          <div className="card stack center" style={{ gap: 10 }}>
            <div className="bold" style={{ textAlign: 'left' }}>Invite students</div>
            <div className="small muted" style={{ textAlign: 'left' }}>
              Share this code. Students enter it under "Join with a code" and join as {defaultRoleName}.
            </div>
            <div className="invite-code">{room.inviteCode}</div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn solid" onClick={shareCode}>
                Share code
              </button>
              <button className="btn outline" disabled={actions.busy} onClick={() => setConfirmNewCode(true)}>
                New code
              </button>
            </div>
          </div>
        )}

        <div className="card">
          <div className="bold">What you can do</div>
          <div style={{ marginTop: 6 }}>
            <PermissionLine label="Manage ledger records" allowed={state.can('RECORDS_MANAGE')} />
            <PermissionLine label="Manage schedule" allowed={state.can('SCHEDULE_MANAGE')} />
            <PermissionLine label="Manage members" allowed={state.can('MEMBERS_MANAGE')} />
            <PermissionLine label="Manage roles" allowed={state.can('ROLES_MANAGE')} />
            <PermissionLine label="Change class settings" allowed={state.can('CLASS_SETTINGS')} />
            <PermissionLine label="Manage class contents" allowed={state.can('CONTENTS_MANAGE')} />
          </div>
        </div>
      </div>

      {confirmNewCode && (
        <ConfirmDialog
          title="Make a new invite code?"
          text={`The current code ${room.inviteCode} will stop working. People already in the class stay.`}
          confirm="Make new code"
          onClose={() => setConfirmNewCode(false)}
          onConfirm={actions.regenerateInviteCode}
        />
      )}
    </div>
  );
}

function PermissionLine({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <div className="row" style={{ padding: '3px 0', gap: 0 }}>
      <span className="bold" style={{ width: 22, color: allowed ? 'var(--primary)' : 'var(--muted)' }} aria-hidden>
        {allowed ? '✓' : '–'}
      </span>
      <span className={allowed ? '' : 'muted'}>
        {label}
        <span className="sr-only">{allowed ? ': allowed' : ': not allowed'}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- Members

function MembersTab({ state, onOpenMember }: { state: ClassState; onOpenMember: (id: string) => void }) {
  const canManage = state.can('MEMBERS_MANAGE');
  return (
    <div className="card flush">
      <div className="small semibold muted" style={{ padding: '0 16px 6px' }}>
        {state.members.length} member{s(state.members.length)}
        {canManage ? '  ·  Tap someone to set their role or courses' : ''}
      </div>
      <div className="members-grid">
        {state.members.map((member) => (
          <MemberRow key={member.id} member={member} state={state} isMe={member.id === state.myUid} onClick={canManage ? () => onOpenMember(member.id) : undefined} />
        ))}
      </div>
    </div>
  );
}

function MemberRow({ member, state, isMe, onClick }: { member: Member; state: ClassState; isMe: boolean; onClick?: () => void }) {
  const role = state.roleOf(member);
  // Only officers who set courses or charge by course see who skips a course; classmates do not.
  const showCourses = state.can('MEMBERS_MANAGE') || state.can('RECORDS_MANAGE');
  const skipped = showCourses ? state.courses.filter((c) => member.excludedCourseIds.includes(c.id)).length : 0;
  const balance = state.balanceOf(member.id);
  const details = [
    state.room?.ledgerEnabled !== false ? balanceText(balance) : null,
    skipped > 0 ? `Does not take ${skipped} course${s(skipped)}` : null,
  ].filter(Boolean);
  const content = (
    <>
      <Avatar photo={state.avatars.get(member.id)} name={member.name} color={hexColor(role?.colorHex, '#6B768A')} />
      <span className="grow ellipsis-box">
        <span className="title ellipsis">{isMe ? `${member.name} (you)` : member.name}</span>
        {details.length > 0 && (
          <span className="sub ellipsis" style={balance < 0 ? { color: 'var(--error)' } : undefined}>
            {details.join('  ·  ')}
          </span>
        )}
      </span>
      <RoleChip name={role?.name ?? 'No role'} color={role?.colorHex ?? '#6B768A'} />
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


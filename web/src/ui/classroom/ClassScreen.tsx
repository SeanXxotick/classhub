import { FileViewerScreen } from '../contents/FileViewer';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { JoinRequest, Member, Permission, ScheduleItem } from '../../data/models';
import { db } from '../../data/firebase';
import { useAnnouncements, useCommentsSince, useMyComments } from '../../data/features';
import { useForum, useForumAnswersSince, useForumAuthors } from '../../data/forum';
import { forumUnseen } from '../../domain/forumUnseen';
import { markTabsSeen, useTabsSeen } from '../../data/tabsSeen';
import { countLabel, SEEN_TABS, unseenCounts, type SeenTab } from '../../domain/tabCounts';
import { AttendanceCard, ClaimsCard, NewsTab, RemindersCard, StatementCard, TimetableCard, TodayCard } from '../features/FeatureUi';
import { GroupingsView } from '../features/GroupingsUi';
import { InviteDialog } from './InviteDialog';
import { LedgerView } from '../../domain/ledgerView';
import { ScheduleView } from '../../domain/scheduleView';
import type { DayKey } from '../../domain/dates';
import { Avatar, ConfirmDialog, Icon, Loading, RoleChip, TopBar, hexColor } from '../common';
import { SearchInput } from '../../design';
import { myAccent, setPinned, startTab, useSettingsVersion } from '../settings';
import { ContentFormScreen, ContentsTab } from '../contents/ContentsUi';
import { AddRecordChooser, balanceText, EntryRow, LedgerSummaryCard, LedgerTab, myBalanceValue } from '../ledger/LedgerUi';
import { ChargeStudentsScreen, RecordRoute } from '../ledger/RecordForms';
import { monthDay, ScheduleFormScreen, ScheduleRow, ScheduleTab } from '../schedule/ScheduleUi';
import { ClassProvider, useClass, type ClassState } from './ClassContext';
import { byLastName, listName, PERMISSIONS } from '../../data/models';
import { CLASS_TABS, tabShownIn, type ClassTabId } from './classTabs';
import { HistoryScreen } from './HistoryScreen';
import { ClassSettingsScreen, CoursesScreen, MemberDetailScreen, permissionLabel, RoleEditorScreen, RolesScreen } from './ManageScreens';
import { MyCoursesScreen, MySettingsScreen } from './MySettingsScreen';
import { SetupChecklist, Welcome } from './Onboarding';

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
  useSettingsVersion();
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
    <div className="accented ch-accented class-frame" style={{ '--accent': hexColor(myAccent(state.classId) ?? state.room?.accentColor) } as CSSProperties}>
      <Routes>
        <Route index element={<ClassScreen />} />
        <Route path="member/:memberId" element={<MemberDetailScreen />} />
        <Route path="roles" element={<RolesScreen />} />
        <Route path="roles/:roleId" element={<RoleEditorScreen />} />
        <Route path="courses" element={<CoursesScreen />} />
        <Route path="settings" element={<ClassSettingsScreen />} />
        <Route path="history" element={<HistoryScreen />} />
        <Route path="mine" element={<MySettingsScreen />} />
        <Route path="mine/courses" element={<MyCoursesScreen />} />
        <Route path="record/:type" element={<RecordRoute />} />
        <Route path="charge" element={<ChargeStudentsScreen />} />
        <Route path="content/:contentId" element={<ContentFormScreen />} />
        <Route path="file/:contentId" element={<FileViewerScreen />} />
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
  const compactFab = useScrollingDown();
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

  // The red counts: what is new on each tab since this user last opened it (domain/tabCounts).
  const hasMe = !!state.me;
  const seen = useTabsSeen(db, state.myUid, state.classId);
  const newsOn = hasMe && tabs.some((t) => t.id === 'NEWS');
  const posts = useAnnouncements(db, state.classId, newsOn).data ?? [];
  const newComments = useCommentsSince(db, state.classId, seen?.NEWS ?? 0, newsOn && !!seen).data ?? [];
  const myComments = useMyComments(db, state.classId, state.myUid, newsOn && !!seen).data ?? [];
  // The Forum counts on the News tab too: new questions, and answers or replies to this member's posts.
  const questions = useForum(db, state.classId, state.can('ANNOUNCEMENTS_MANAGE'), newsOn).data ?? [];
  const myForumIds = new Set((useForumAuthors(db, state.classId, state.myUid, false, newsOn).data ?? []).map((a) => a.id));
  const forumAnswers = useForumAnswersSince(db, state.classId, seen?.NEWS ?? 0, newsOn && !!seen).data ?? [];
  const forumNew = forumUnseen(questions, forumAnswers, state.myUid, myForumIds, seen?.NEWS ?? 0).total;
  const tabCounts = unseenCounts({
    seen,
    myUid: state.myUid,
    records: state.records,
    schedule: state.schedule,
    contents: state.contents,
    posts,
    comments: newComments,
    myCommentIds: new Set(myComments.map((c) => c.id)),
    joinRequests: state.can('MEMBERS_MANAGE') ? state.joinRequests.length : 0,
    takes: state.takes,
  });
  const counts = { ...tabCounts, NEWS: tabCounts.NEWS + forumNew };
  // The open tab never shows a count.
  const countOf = (id: ClassTabId) => (id === tab || id === 'HOME' ? 0 : counts[id]);
  const tabLabel = (id: ClassTabId, label: string) => {
    const n = countOf(id);
    return n === 0 ? undefined : `${label}, ${n} ${id === 'MEMBERS' ? 'waiting to join' : 'new'}`;
  };
  // The first visit since counts began starts every tab at zero, so old posts never count.
  const firstVisit = seen === null;
  useEffect(() => {
    if (hasMe && firstVisit) markTabsSeen(db, state.myUid, state.classId, SEEN_TABS).catch(() => undefined);
  }, [hasMe, firstVisit, state.myUid, state.classId]);
  // Opening a tab clears its count; so does leaving it, for what came in while it was open.
  useEffect(() => {
    const open = tab as SeenTab;
    if (!hasMe || !SEEN_TABS.includes(open)) return;
    const mark = () => {
      markTabsSeen(db, state.myUid, state.classId, [open]).catch(() => undefined);
    };
    mark();
    return mark;
  }, [tab, hasMe, state.myUid, state.classId]);

  let fab: { label: string; onClick: () => void } | null = null;
  if (tab === 'LEDGER' && state.can('RECORDS_MANAGE')) fab = { label: 'New record', onClick: () => setChoosingRecord(true) };
  if (tab === 'SCHEDULE' && state.can('SCHEDULE_MANAGE')) {
    fab = {
      label: scheduleDay ? `Add on ${monthDay(scheduleDay)}` : 'Add',
      onClick: () => navigate(`${base}/schedule/new` + (scheduleDay ? `?day=${scheduleDay}` : '')),
    };
  }
  if (tab === 'CONTENTS' && state.can('CONTENTS_MANAGE')) fab = { label: 'Add content', onClick: () => navigate(`${base}/content/new`) };

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
              <button key={t.id} type="button" data-tour={`tab-${t.id}`} className={'tab' + (t.id === tab ? ' selected' : '')} aria-current={t.id === tab ? 'page' : undefined} aria-label={tabLabel(t.id, t.label)} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={20} />
                {t.label}
                {countOf(t.id) > 0 && <span className="tab-count" aria-hidden>{countLabel(countOf(t.id))}</span>}
              </button>
            ))}
          </nav>
        )}
        {room && state.me && !state.loading && !state.error && <Welcome state={state} />}
        {room && state.me && !state.loading && !state.error && tab === 'SCHEDULE' && (
          <div className="stack" style={{ marginBottom: 12 }}>
            {/* The timetable and attendance are part of the Schedule module. */}
            <TimetableCard state={state} />
            <AttendanceCard state={state} />
          </div>
        )}
        {state.loading ? (
          <Loading />
        ) : state.error ? (
          <p className="error-text center" style={{ padding: 32 }}>{state.error}</p>
        ) : !room || !state.me ? null : tab === 'HOME' ? (
          <HomeTab state={state} onSeeLedger={() => setTab('LEDGER')} onSeeSchedule={() => setTab('SCHEDULE')} onSeeNews={() => setTab('NEWS')} onToggleDone={onToggleDone} />
        ) : tab === 'NEWS' ? (
          <NewsTab state={state} />
        ) : tab === 'MEMBERS' ? (
          <MembersTab state={state} onApprove={actions.approveRequest} onReject={actions.rejectRequest} onOpenMember={(id) => navigate(`${base}/member/${id}`)} />
        ) : tab === 'LEDGER' ? (
          <LedgerTab
            state={state}
            extras={
              <>
                <StatementCard state={state} />
                <ClaimsCard state={state} />
                <RemindersCard state={state} />
              </>
            }
            onDeleteRecord={actions.deleteRecord}
            onUndoCharge={actions.undoCharge}
            onSaveSettings={(visibility, info) => actions.saveLedgerSettings(visibility, info)}
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
          <ContentsTab state={state} onEdit={(id) => navigate(`${base}/content/${id}`)} onNotice={actions.showNotice} />
        )}
      </div>

      {fab && (
        <button className={'btn solid fab' + (compactFab ? ' compact' : '')} aria-label={compactFab ? fab.label : undefined} onClick={fab.onClick}>
          <span className="fab-plus" aria-hidden>
            +
          </span>
          <span className="fab-text">{fab.label}</span>
        </button>
      )}

      {room && (
        <nav className="bottom-nav phone-only" aria-label="Class sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" data-tour={`tab-${t.id}`} className={t.id === tab ? 'selected' : ''} aria-current={t.id === tab ? 'page' : undefined} aria-label={tabLabel(t.id, t.label)} onClick={() => setTab(t.id)}>
              <span className="nav-icon">
                <Icon name={t.icon} size={24} />
                {countOf(t.id) > 0 && <span className="tab-count" aria-hidden>{countLabel(countOf(t.id))}</span>}
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

/** True while the page is being scrolled down, so the add button can shrink to "+" and cover less of the list. */
function useScrollingDown(): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setDown(y > last && y > 80);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return down;
}

// ---------------------------------------------------------------- Home

function HomeTab({
  state,
  onSeeLedger,
  onSeeSchedule,
  onSeeNews,
  onToggleDone,
}: {
  state: ClassState;
  onSeeLedger: () => void;
  onSeeSchedule: () => void;
  onSeeNews: () => void;
  onToggleDone: (item: ScheduleItem, done: boolean) => void;
}) {
  const { actions } = useClass();
  const navigate = useNavigate();
  const [confirmNewCode, setConfirmNewCode] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const room = state.room!;
  const base = `/class/${state.classId}`;
  const canRoles = state.can('ROLES_MANAGE');
  const canCourses = state.can('CLASS_SETTINGS');
  const now = Date.now();
  // Home is personal: an officer who sees every course still gets only their own here.
  const mySchedule = state.schedule.filter((i) => state.takes(i.courseId));
  const upcoming = ScheduleView.filter(mySchedule, 'UPCOMING', now, state.myDone).slice(0, 3);
  const overdue = ScheduleView.filter(mySchedule, 'OVERDUE', now, state.myDone).length;
  const ledgerOfficer = state.can('RECORDS_MANAGE');
  const recent = LedgerView.entries(state.records).slice(0, 3);
  const defaultRoleName = state.roles.find((r) => r.id === room.defaultRoleId)?.name ?? 'Member';

  const shareCode = () => setInviteOpen(true);

  // Two columns on wide screens. On a phone the sections line up in the order a student needs them
  // (the home-order classes): the class, the officer's Manage card, today's meetings, what is due, then the money.
  return (
    <div className="home-grid">
      <div className="stack home-col">
        <section className="card class-header home-order-1" aria-label={room.name}>
          <Avatar photo={state.classPhoto} name={room.name} color="var(--primary)" size={56} circle={false} />
          <span className="grow ellipsis-box">
            <span className="class-name">{room.name}</span>
            {room.description.trim() && <span className="muted clamp-2">{room.description}</span>}
            <span className="small semibold muted class-meta">
              {state.members.length} member{s(state.members.length)}&nbsp;&nbsp;·&nbsp;&nbsp;You are {state.myRole?.name ?? 'a member'}
            </span>
          </span>
        </section>

        <SetupChecklist state={state} go={{ courses: () => navigate(`${base}/courses`), timetable: onSeeSchedule, ledger: onSeeLedger, invite: shareCode, news: onSeeNews }} />

        {(canRoles || canCourses) && (
          <section className="home-section home-order-1">
            <SectionHead title="Manage" />
            <div className="card manage-card">
              {canRoles && (
                <button className="btn outline small" onClick={() => navigate(`${base}/roles`)}>
                  Roles ({state.roles.length})
                </button>
              )}
              {canCourses && (
                <button className="btn outline small" onClick={() => navigate(`${base}/courses`)}>
                  Courses ({state.courses.length})
                </button>
              )}
              {canCourses && (
                <button className="btn outline small" onClick={() => navigate(`${base}/settings`)}>
                  Class settings
                </button>
              )}
              {canCourses && (
                <button className="btn outline small" onClick={() => navigate(`${base}/history`)}>
                  History log
                </button>
              )}
            </div>
          </section>
        )}

        {room.scheduleEnabled !== false && (
          <div className="home-order-1 home-today">
            <TodayCard state={state} />
          </div>
        )}

        {room.scheduleEnabled && (
          <section className="home-section home-order-2">
            <SectionHead
              title="Coming up"
              sub={overdue > 0 && <span className="small semibold error-text">{overdue} overdue item{s(overdue)}</span>}
              action={
                <button className="btn text" onClick={onSeeSchedule}>
                  Schedule ›
                </button>
              }
            />
            <div className="card flush">
              {upcoming.length === 0 && (
                <div className="empty-quiet" style={{ padding: '6px 16px' }}>
                  <span className="empty-check" aria-hidden>✓</span>
                  <span>Nothing due soon. You are all caught up.</span>
                </div>
              )}
              {upcoming.map((item) => (
                <ScheduleRow key={item.id} item={item} state={state} now={now} showDate onToggleDone={onToggleDone} />
              ))}
            </div>
          </section>
        )}

      </div>

      <div className="stack home-col">
        {room.ledgerEnabled && (
          <section className="home-section home-order-3">
            <LedgerSummaryCard state={state} />
            {ledgerOfficer && (() => {
              const myBal = state.balanceOf(state.myUid);
              return (
                // Officers see the class fund above, so their own balance goes under it.
                <div className={'card balance-strip' + (myBal < 0 ? ' owes' : '')}>
                  <span className="grow muted semibold">Your balance</span>
                  <span className="bold money">{myBalanceValue(myBal)}</span>
                </div>
              );
            })()}
          </section>
        )}

        {room.ledgerEnabled && (
          <section className="home-section home-order-4">
            <SectionHead
              title="Recent"
              action={
                <button className="btn text" onClick={onSeeLedger}>
                  Ledger ›
                </button>
              }
            />
            <div className="card flush">
              {recent.length === 0 && <p className="muted" style={{ margin: 0, padding: '6px 16px' }}>No records yet.</p>}
              {recent.map((entry) => (
                <EntryRow key={entry.key} entry={entry} state={state} />
              ))}
            </div>
          </section>
        )}

        {state.can('MEMBERS_MANAGE') && (
          <section className="home-section home-order-6">
            <SectionHead title="Invite students" />
            <div className="card stack center" style={{ gap: 10 }}>
              <div className="small muted" style={{ textAlign: 'left' }}>
                Students join as {defaultRoleName}.
              </div>
              <div className="invite-code">{room.inviteCode}</div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn solid" onClick={shareCode}>
                  Share invite
                </button>
                <button className="btn outline" disabled={actions.busy} onClick={() => setConfirmNewCode(true)}>
                  New code
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="home-section home-order-7">
          {(() => {
            const activePerms = PERMISSIONS.filter((p) => moduleOn(state, p));
            const hasAny = activePerms.some((p) => state.can(p));
            if (!hasAny) {
              return (
                <div className="card" style={{ padding: '14px 16px' }}>
                  <p className="small muted" style={{ margin: 0 }}>
                    <b style={{ color: 'var(--on-surface)' }}>{state.myRole?.name ?? 'Member'}</b> · View-only access. Officers manage the ledger, schedule, contents and news.
                  </p>
                </div>
              );
            }
            return (
              <>
                <SectionHead title="What you can do" />
                <div className="card">
                  {/* Every permission, named as in the role editor, so a new one shows here too. Those of a module that is turned off are left out. */}
                  {activePerms.map((p) => (
                    <PermissionLine key={p} label={permissionLabel(p)[0]} allowed={state.can(p)} />
                  ))}
                </div>
              </>
            );
          })()}
        </section>
      </div>

      {inviteOpen && (
        <InviteDialog className={room.name} code={room.inviteCode} roleName={defaultRoleName} notify={actions.showNotice} onClose={() => setInviteOpen(false)} />
      )}

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

/** A section title above its card, with an optional line under it and a link on the right. */
function SectionHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-head">
      <span className="grow">
        <h2>{title}</h2>
        {sub}
      </span>
      {action}
    </div>
  );
}

function PermissionLine({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <div className="row" style={{ padding: '3px 0', gap: 0 }}>
      <span className="bold" style={{ width: 22, color: allowed ? 'var(--primary)' : 'var(--muted)' }} aria-hidden>
        {allowed ? '✓' : '✕'}
      </span>
      <span className={allowed ? '' : 'muted'}>
        {label}
        <span className="sr-only">{allowed ? ': allowed' : ': not allowed'}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- Members

function MembersTab({
  state,
  onOpenMember,
  onApprove,
  onReject,
}: {
  state: ClassState;
  onOpenMember: (id: string) => void;
  onApprove: (request: JoinRequest) => void;
  onReject: (request: JoinRequest) => void;
}) {
  const canManage = state.can('MEMBERS_MANAGE');
  const [params, setParams] = useSearchParams();
  const inGroups = params.get('view') === 'groups';
  const setView = (view: 'members' | 'groups') =>
    setParams(view === 'groups' ? { tab: 'MEMBERS', view: 'groups' } : { tab: 'MEMBERS' }, { replace: true });

  return (
    <div className="stack">
      <div className="ch-segmented ch-full news-switch" role="group" aria-label="Members">
        <button type="button" className={!inGroups ? 'ch-selected' : ''} aria-pressed={!inGroups} onClick={() => setView('members')}>
          Members ({state.members.length})
        </button>
        <button type="button" className={inGroups ? 'ch-selected' : ''} aria-pressed={inGroups} onClick={() => setView('groups')}>
          Groups
        </button>
      </div>
      {inGroups ? (
        <GroupingsView state={state} />
      ) : (
        <>
          {canManage && state.joinRequests.length > 0 && (
            <div className="card flush">
              <div className="small semibold muted" style={{ padding: '0 16px 6px' }}>
                Waiting for approval ({state.joinRequests.length})
              </div>
              {state.joinRequests.map((r) => (
                <div key={r.uid} className="list-row">
                  <Avatar name={r.name} color="#6B768A" />
                  <span className="grow ellipsis-box">
                    <span className="title ellipsis">{r.name}</span>
                    <span className="sub ellipsis">Asked to join with the invite code</span>
                  </span>
                  <button type="button" className="btn text" onClick={() => onReject(r)}>
                    Reject
                  </button>
                  <button type="button" className="btn solid" onClick={() => onApprove(r)}>
                    Approve
                  </button>
                </div>
              ))}
            </div>
          )}
          <MembersList state={state} canManage={canManage} onOpenMember={onOpenMember} />
        </>
      )}
    </div>
  );
}

function MembersList({ state, canManage, onOpenMember }: { state: ClassState; canManage: boolean; onOpenMember: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'OWES' | 'OFFICERS'>('ALL');
  const canFilterOwes = state.room?.ledgerEnabled !== false && state.seeAll;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = byLastName(state.members).filter((m) => {
    if (filter === 'OWES' && canFilterOwes && state.balanceOf(m.id) >= 0) return false;
    if (filter === 'OFFICERS') {
      const role = state.roleOf(m);
      if (!role || (!role.locked && role.permissions.length === 0)) return false;
    }
    if (words.length === 0) return true;
    const roleName = state.roleOf(m)?.name ?? '';
    const hay = `${m.name} ${listName(m)} ${roleName}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const activeFilter = filter === 'OWES' && !canFilterOwes ? 'ALL' : filter;
  return (
    <div className="stack">
      {state.members.length > 0 && (
        <>
          <SearchInput aria-label="Search members" placeholder="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="chips" role="tablist" aria-label="Filter members">
            {(
              [
                ['ALL', 'All'],
                ...(canFilterOwes ? ([['OWES', 'Owes money']] as const) : []),
                ['OFFICERS', 'Officers'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={activeFilter === id} className={'chip' + (activeFilter === id ? ' selected' : '')} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="card flush">
        <div className="small semibold muted" style={{ padding: '0 16px 6px' }}>
          {words.length > 0 || activeFilter !== 'ALL'
            ? `${shown.length} of ${state.members.length} member${s(state.members.length)}`
            : `${state.members.length} member${s(state.members.length)}`}
          {canManage ? '  ·  Tap someone to set their role or courses' : ''}
        </div>
        {shown.length === 0 ? (
          <p className="empty" style={{ padding: 20 }}>Nothing matches.</p>
        ) : (
          <div className="members-grid">
            {shown.map((member) => (
              <MemberRow key={member.id} member={member} state={state} isMe={member.id === state.myUid} onClick={() => onOpenMember(member.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The module a permission belongs to. Permissions that are not listed work with every module off. */
const PERMISSION_MODULE: Partial<Record<Permission, 'ledgerEnabled' | 'scheduleEnabled' | 'contentsEnabled' | 'announcementsEnabled'>> = {
  RECORDS_MANAGE: 'ledgerEnabled',
  SCHEDULE_MANAGE: 'scheduleEnabled',
  ATTENDANCE_MANAGE: 'scheduleEnabled',
  CONTENTS_MANAGE: 'contentsEnabled',
  ANNOUNCEMENTS_MANAGE: 'announcementsEnabled',
};
const moduleOn = (state: ClassState, p: Permission): boolean => {
  const module = PERMISSION_MODULE[p];
  return !module || state.room?.[module] !== false;
};

function MemberRow({ member, state, isMe, onClick }: { member: Member; state: ClassState; isMe: boolean; onClick?: () => void }) {
  const role = state.roleOf(member);
  // Only officers who set courses or charge by course see who skips a course; classmates do not.
  const showCourses = state.can('MEMBERS_MANAGE') || state.can('RECORDS_MANAGE');
  const skipped = showCourses ? state.courses.filter((c) => member.excludedCourseIds.includes(c.id)).length : 0;
  const balance = state.balanceOf(member.id);
  const showBalance = state.room?.ledgerEnabled !== false && (state.seeAll || isMe);
  const details = [
    showBalance ? balanceText(balance) : null,
    skipped > 0 ? `Does not take ${skipped} course${s(skipped)}` : null,
  ].filter(Boolean);
  const content = (
    <>
      <Avatar photo={state.avatars.get(member.id)} name={member.name} color={hexColor(role?.colorHex, '#6B768A')} />
      <span className="grow ellipsis-box">
        <span className="title ellipsis">{isMe ? `${listName(member)} (you)` : listName(member)}</span>
        {details.length > 0 && (
          <span className="sub ellipsis" style={showBalance && balance < 0 ? { color: 'var(--error)' } : undefined}>
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


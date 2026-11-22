/*
 * Project & Lab Groupings (inside the Members tab):
 * Supports single-class and cross-class shared groupings (G1 + G2),
 * per-group capacities, optional group leaders (first to join, passable,
 * leader-only join approval & guests), collapsible cards/groups, and plain-text export.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { byLastName, listName } from '../../data/models';
import { savePartnerClass, usePartnerClasses } from '../../data/partners';
import {
  GROUPING_MAX_GROUPS,
  GROUPING_NOTE_MAX,
  GROUPING_TITLE_MAX,
  GROUP_NAME_MAX,
  GUEST_NAME_MAX,
  GUEST_TAG_MAX,
  SHARED_MAX_CLASSES,
  addGroupSlot,
  addGuestTeammate,
  approveJoinRequest,
  autoAssignUngrouped,
  cancelJoinRequest,
  createGrouping,
  deleteGroupSlot,
  deleteGrouping,
  disableGroupingSharing,
  editGroupSlot,
  enableGroupingSharing,
  joinGroup,
  leaveGroup,
  linkSharedGrouping,
  rejectJoinRequest,
  removeGuestTeammate,
  requestJoinGroup,
  setGroupLeader,
  setGroupingHasLeader,
  setGroupingLocked,
  syncSharedRoster,
  unlinkSharedGrouping,
  updateGroupingMeta,
  useGroupings,
  type GroupSlot,
  type Grouping,
  type MemberMeta,
  type SharedRosterEntry,
} from '../../data/groupings';
import {
  effectiveLeaderUid,
  findMemberGroup,
  formatGroupingExport,
  groupSize,
  isGroupFull,
  ungroupedMemberIds,
} from '../../domain/groupingLogic';
import { Button, Card, Notice, SearchInput, Switch } from '../../design';
import { ConfirmDialog, Dialog, Field, hexColor } from '../common';
import { myAccent } from '../settings';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { MoreMenu } from '../MoreMenu';
import { TagBadge, TagSelect } from './ForumUi';

const GUEST_TAG_PRESETS_LOCAL = ['', 'Irregular', 'G2'] as const;
const GUEST_TAG_PRESETS_SHARED = ['', 'Irregular', 'Cross-enroll'] as const;

function guessSectionTag(className: string): string {
  const m = className.match(/\b(G\d+|[A-Z]\d+)\b/i);
  if (m) return m[1].toUpperCase();
  return className.trim().slice(0, 12) || 'Sec';
}

/**
 * Resolves the color for a linked class badge:
 * uses the student's personal color override (`myAccent`) if they set one for that class,
 * otherwise falls back to that class's real default `accentColor`.
 */
function tagStyleForClass(state: ClassState, grouping: Grouping, classId: string): CSSProperties | undefined {
  const personal = myAccent(classId);
  const stored = grouping.linkedClasses?.[classId]?.accentColor;
  const localDefault = classId === state.classId ? state.room?.accentColor : undefined;
  const raw = personal ?? stored ?? localDefault;
  if (!raw) return undefined;
  return { '--tag-color': hexColor(raw) } as CSSProperties;
}

function useRun() {
  const { actions } = useClass();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = (success: string, work: () => Promise<unknown>, onDone?: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    work()
      .then(() => {
        if (success) actions.showNotice(success);
        onDone?.();
      })
      .catch((e) => actions.showNotice(friendlyMessage(e)))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  return Object.assign(run, { busy });
}

export function GroupingsView({ state }: { state: ClassState }) {
  const manage = state.can('MEMBERS_MANAGE');
  const groupings = useGroupings(db, state.classId, true).data;
  const [tag, setTag] = useState('*');
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState<Grouping | null>(null);
  const [deleting, setDeleting] = useState<Grouping | null>(null);
  const run = useRun();

  const visible = useMemo(
    () => (groupings ?? []).filter((g) => (manage || state.takes(g.courseId)) && (tag === '*' || g.courseId === tag)),
    [groupings, manage, state, tag],
  );

  return (
    <div className="stack">
      {manage && (
        <div className="ch-row ch-wrap ch-gap-2">
          <Button icon="plus" onClick={() => setCreating(true)}>
            New grouping
          </Button>
          <Button variant="outline" icon="link" onClick={() => setLinking(true)}>
            Link with code
          </Button>
        </div>
      )}
      {(groupings ?? []).length > 0 && state.courses.length > 0 && (
        <div className="forum-search">
          <TagSelect state={state} value={tag} onChange={setTag} label="Course" all allLabel="All courses" />
        </div>
      )}
      {groupings && visible.length === 0 && (
        <Notice tone="info">{tag === '*' ? 'No groupings yet.' : 'No groupings for this course.'}</Notice>
      )}
      {visible.map((grouping) => (
        <GroupingCard
          key={`${grouping.shared ? 's' : 'l'}-${grouping.id}`}
          state={state}
          grouping={grouping}
          defaultOpen={false}
          manage={manage}
          onEdit={() => setEditing(grouping)}
          onToggleLock={() =>
            run(
              grouping.locked ? 'Grouping unlocked.' : 'Grouping locked.',
              () => setGroupingLocked(db, state.myUid, state.classId, grouping, !grouping.locked),
            )
          }
          onToggleLeader={() =>
            run(
              grouping.hasLeader ? 'Group leaders turned off.' : 'Group leaders turned on.',
              () => setGroupingHasLeader(db, state.myUid, state.classId, grouping, !grouping.hasLeader),
            )
          }
          onDelete={() => setDeleting(grouping)}
        />
      ))}
      {creating && <NewGroupingDialog state={state} onClose={() => setCreating(false)} />}
      {linking && <LinkSharedGroupingDialog state={state} onClose={() => setLinking(false)} />}
      {editing && <EditGroupingDialog state={state} grouping={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          text={deleting.shared ? 'Deletes this grouping for all linked classes.' : 'Removes this grouping for everyone.'}
          confirm="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            run('Grouping deleted.', () => deleteGrouping(db, state.myUid, state.classId, deleting), () => setDeleting(null))
          }
        />
      )}
    </div>
  );
}

function GroupingCard({
  state,
  grouping,
  defaultOpen,
  manage,
  onEdit,
  onToggleLock,
  onToggleLeader,
  onDelete,
}: {
  state: ClassState;
  grouping: Grouping;
  defaultOpen: boolean;
  manage: boolean;
  onEdit: () => void;
  onToggleLock: () => void;
  onToggleLeader: () => void;
  onDelete: () => void;
}) {
  const { actions } = useClass();
  const run = useRun();
  const [cardOpen, setCardOpen] = useState(defaultOpen);
  const [openSlots, setOpenSlots] = useState<Record<string, boolean>>({});
  const [showUngrouped, setShowUngrouped] = useState(false);
  const [addingSlot, setAddingSlot] = useState(false);
  const [editingSlot, setEditingSlot] = useState<GroupSlot | null>(null);
  const [assigningSlot, setAssigningSlot] = useState<GroupSlot | null>(null);
  const [passingSlot, setPassingSlot] = useState<GroupSlot | null>(null);
  const [assigningMember, setAssigningMember] = useState<{ uid: string; name: string; classId: string; tag: string } | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [confirmAutoAssign, setConfirmAutoAssign] = useState(false);
  const [confirmLeaveSlot, setConfirmLeaveSlot] = useState<GroupSlot | null>(null);
  const [confirmUnlinkSelf, setConfirmUnlinkSelf] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<
    | { kind: 'member'; uid: string; name: string; slotName: string }
    | { kind: 'guest'; slotId: string; guestId: string; name: string; slotName: string }
    | null
  >(null);

  const memberById = useMemo(() => new Map(state.members.map((m) => [m.id, m])), [state.members]);
  const eligibleMembers = useMemo(
    () =>
      byLastName(
        grouping.courseId
          ? state.members.filter((m) => !m.excludedCourseIds.includes(grouping.courseId))
          : state.members,
      ),
    [state.members, grouping.courseId],
  );
  const mySectionTag = grouping.linkedClasses?.[state.classId]?.tag ?? guessSectionTag(state.room?.name ?? '');
  const localRoster: SharedRosterEntry[] = useMemo(
    () => eligibleMembers.map((m) => ({ uid: m.id, name: listName(m) })),
    [eligibleMembers],
  );

  // Keep this class's roster snapshot and default accent color synced on shared groupings.
  const storedRosterSig = useMemo(() => {
    const r = grouping.linkedClasses?.[state.classId]?.roster;
    return r ? r.map((x) => `${x.uid}:${x.name}`).join('|') : '';
  }, [grouping.linkedClasses, state.classId]);
  const localRosterSig = useMemo(
    () => localRoster.map((x) => `${x.uid}:${x.name}`).join('|'),
    [localRoster],
  );
  const storedAccent = (grouping.linkedClasses?.[state.classId]?.accentColor ?? '').toUpperCase();
  const localAccent = (state.room?.accentColor ?? '').toUpperCase();
  useEffect(() => {
    if (!manage || !grouping.shared || !grouping.linkedClasses?.[state.classId]) return;
    if (storedRosterSig === localRosterSig && storedAccent === localAccent) return;
    void syncSharedRoster(db, state.classId, grouping, localRoster, state.room?.accentColor ?? '').catch(() => undefined);
  }, [manage, grouping.shared, grouping.id, state.classId, storedRosterSig, localRosterSig, storedAccent, localAccent]);

  // Ensure any class linked via a shared grouping is registered as a mutual partner class for shared polls.
  const partners = usePartnerClasses(db, state.classId, manage && !!grouping.shared).data;
  const syncedMutualRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!manage || !grouping.shared || !partners) return;
    const myLink = grouping.linkedClasses?.[state.classId];
    for (const cid of grouping.linkedClassIds ?? []) {
      if (cid === state.classId) continue;
      const other = grouping.linkedClasses?.[cid];
      if (!other) continue;
      const existing = partners.find((p) => p.partnerClassId === cid);
      const wantAccent = other.accentColor ?? '';
      if (!existing || existing.name !== other.name || existing.tag !== other.tag || existing.accentColor !== wantAccent) {
        void savePartnerClass(db, state.classId, {
          partnerClassId: cid,
          name: other.name,
          tag: other.tag,
          accentColor: wantAccent,
        }).catch(() => undefined);
      }
      const mutualKey = `${state.classId}:${cid}:${grouping.id}`;
      if (myLink && !syncedMutualRef.current.has(mutualKey)) {
        syncedMutualRef.current.add(mutualKey);
        void savePartnerClass(
          db,
          cid,
          {
            partnerClassId: state.classId,
            name: myLink.name || state.room?.name || 'Partner class',
            tag: myLink.tag || mySectionTag,
            accentColor: state.room?.accentColor ?? myLink.accentColor ?? '',
          },
          { sharedGroupingId: grouping.id },
        ).catch(() => undefined);
      }
    }
  }, [manage, grouping.shared, grouping.id, grouping.linkedClassIds, grouping.linkedClasses, partners, state.classId, state.room?.name, state.room?.accentColor, mySectionTag]);

  const combinedEligible = useMemo(() => {
    const seen = new Set<string>();
    const list: { uid: string; name: string; classId: string; tag: string }[] = [];
    for (const m of eligibleMembers) {
      seen.add(m.id);
      list.push({ uid: m.id, name: listName(m), classId: state.classId, tag: mySectionTag });
    }
    if (grouping.shared) {
      for (const cid of grouping.linkedClassIds ?? []) {
        if (cid === state.classId) continue;
        const link = grouping.linkedClasses?.[cid];
        for (const r of link?.roster ?? []) {
          if (seen.has(r.uid)) continue;
          seen.add(r.uid);
          list.push({ uid: r.uid, name: r.name, classId: cid, tag: link?.tag ?? '' });
        }
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [eligibleMembers, state.classId, mySectionTag, grouping.shared, grouping.linkedClassIds, grouping.linkedClasses]);

  const ungroupedIds = useMemo(
    () => ungroupedMemberIds(grouping.groups, combinedEligible.map((e) => e.uid)),
    [grouping.groups, combinedEligible],
  );
  const ungroupedSet = useMemo(() => new Set(ungroupedIds), [ungroupedIds]);
  const ungroupedEntries = useMemo(
    () => combinedEligible.filter((e) => ungroupedSet.has(e.uid)),
    [combinedEligible, ungroupedSet],
  );
  const eligibleByUid = useMemo(() => new Map(combinedEligible.map((e) => [e.uid, e])), [combinedEligible]);

  const myGroup = findMemberGroup(grouping.groups, state.myUid);
  const myPendingGroup = grouping.groups.find((g) => (g.joinRequests ?? []).some((r) => r.uid === state.myUid));
  const canSelfEdit = grouping.selfJoin && !grouping.locked;
  const totalMembers = grouping.groups.reduce((sum, g) => sum + g.memberUids.length, 0);
  const totalGuests = grouping.groups.reduce((sum, g) => sum + g.guests.length, 0);
  const pendingForMeCount = grouping.hasLeader
    ? grouping.groups.reduce((sum, g) => {
        const leaderUid = effectiveLeaderUid(g, true);
        if (manage || (!grouping.locked && leaderUid === state.myUid)) {
          return sum + (g.joinRequests?.length ?? 0);
        }
        return sum;
      }, 0)
    : 0;
  const courseName = grouping.courseId ? state.courses.find((c) => c.id === grouping.courseId)?.name ?? '' : '';
  const isHost = !grouping.shared || grouping.hostClassId === state.classId;
  const myName = state.me ? listName(state.me) : 'Member';

  const isSlotOpen = (slot: GroupSlot) => {
    if (slot.id in openSlots) return openSlots[slot.id];
    const isMine = myGroup?.id === slot.id;
    const leaderUid = effectiveLeaderUid(slot, grouping.hasLeader);
    const hasPendingForMe =
      !!grouping.hasLeader &&
      (slot.joinRequests?.length ?? 0) > 0 &&
      (manage || (!grouping.locked && leaderUid === state.myUid));
    return isMine || hasPendingForMe;
  };
  const allOpen = grouping.groups.every(isSlotOpen);
  const toggleSlot = (slot: GroupSlot) =>
    setOpenSlots((prev) => ({ ...prev, [slot.id]: !isSlotOpen(slot) }));
  const setAllSlots = (open: boolean) => {
    const next: Record<string, boolean> = {};
    for (const s of grouping.groups) next[s.id] = open;
    setOpenSlots(next);
  };

  const metaForUid = (uid: string): MemberMeta | undefined => {
    if (!grouping.shared) return undefined;
    const entry = eligibleByUid.get(uid);
    if (entry) return { name: entry.name, classId: entry.classId, tag: entry.tag };
    const m = memberById.get(uid);
    return {
      name: m ? listName(m) : myName,
      classId: state.classId,
      tag: mySectionTag,
    };
  };

  async function copyList() {
    const text = formatGroupingExport(grouping, courseName, (uid, slot) => {
      const m = memberById.get(uid);
      if (m) return listName(m);
      return slot.memberMeta?.[uid]?.name ?? 'Former member';
    });
    try {
      await navigator.clipboard.writeText(text);
      actions.showNotice('Group list copied.');
    } catch {
      actions.showNotice('Could not copy to clipboard.');
    }
  }

  const linkedList = grouping.shared
    ? (grouping.linkedClassIds ?? []).map((cid, idx) => ({
        classId: cid,
        isHost: cid === grouping.hostClassId,
        ...(grouping.linkedClasses?.[cid] ?? { name: cid, tag: `S${idx + 1}`, courseId: '' }),
      }))
    : [];

  return (
    <Card>
      <div className="stack" style={{ gap: 12 }}>
        <div className="card-head">
          <button
            type="button"
            className="grp-card-toggle"
            aria-expanded={cardOpen}
            onClick={() => setCardOpen(!cardOpen)}
          >
            <div className="stack" style={{ gap: 6, minWidth: 0, flex: 1 }}>
              {grouping.courseId && (
                <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
                  <TagBadge state={state} courseId={grouping.courseId} />
                </div>
              )}
              <div className="bold" style={{ fontSize: 17, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {grouping.title}
              </div>
              {grouping.note && <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{grouping.note}</div>}
              <div className="ch-small ch-muted">
                {`${grouping.groups.length} group${grouping.groups.length === 1 ? '' : 's'} · ${totalMembers} member${totalMembers === 1 ? '' : 's'}`}
                {totalGuests > 0 ? ` · ${totalGuests} guest${totalGuests === 1 ? '' : 's'}` : ''}
                {myGroup ? ` · ${myGroup.name}` : ''}
                {grouping.locked ? ' · Locked' : ''}
                {!myGroup && state.takes(grouping.courseId) && (
                  <>
                    {' · '}
                    <span className="grp-req-pill">{myPendingGroup ? 'No group yet · Pending' : 'No group yet'}</span>
                  </>
                )}
                {pendingForMeCount > 0 && !cardOpen && (
                  <>
                    {' · '}
                    <span className="grp-req-pill">{`${pendingForMeCount} request${pendingForMeCount === 1 ? '' : 's'}`}</span>
                  </>
                )}
              </div>
            </div>
            <span className={'grp-chev' + (cardOpen ? ' open' : '')} aria-hidden>
              ▾
            </span>
          </button>
          <div className="ch-row ch-gap-1" style={{ alignItems: 'center', flex: 'none' }}>
            <MoreMenu
              label={`More for "${grouping.title}"`}
              title={grouping.title}
              items={[
                { label: 'Copy group list', icon: 'list', onClick: () => void copyList() },
                manage && grouping.shared && { label: 'Share code & linked classes', icon: 'link', onClick: () => setSharingOpen(true) },
                manage && { label: grouping.hasLeader ? 'Turn off leaders' : 'Turn on leaders', icon: 'shield', onClick: onToggleLeader },
                manage && { label: grouping.locked ? 'Unlock grouping' : 'Lock grouping', icon: 'lock', onClick: onToggleLock },
                manage && { label: 'Add a group', icon: 'plus', onClick: () => setAddingSlot(true) },
                manage && { label: 'Edit details', icon: 'edit', onClick: onEdit },
                manage && isHost && { label: 'Delete', icon: 'trash', danger: true, onClick: onDelete },
                manage && !isHost && grouping.shared && {
                  label: 'Unlink from this class',
                  icon: 'logout',
                  danger: true,
                  onClick: () => setConfirmUnlinkSelf(true),
                },
              ]}
            />
          </div>
        </div>

        {cardOpen && (
          <>
            {!myGroup && state.takes(grouping.courseId) && (
              <Notice tone="danger">
                {myPendingGroup
                  ? `You do not have a group yet. Waiting for ${myPendingGroup.name} to approve your request.`
                  : 'You do not have a group yet.'}
              </Notice>
            )}
            {grouping.shared && (
              <div className="grp-linked-strip">
                <div className="ch-row ch-wrap ch-gap-1" style={{ alignItems: 'center', minWidth: 0 }}>
                  <span className="tiny muted">Linked:</span>
                  {linkedList.map((c) => (
                    <span
                      key={c.classId}
                      className="grp-sec-tag"
                      style={tagStyleForClass(state, grouping, c.classId)}
                    >
                      {c.name} ({c.tag}){c.isHost ? ' · Host' : ''}
                    </span>
                  ))}
                </div>
                {manage && grouping.shareCode && (
                  <button type="button" className="grp-code-pill" onClick={() => setSharingOpen(true)}>
                    {grouping.shareCode}
                  </button>
                )}
              </div>
            )}

            {ungroupedEntries.length > 0 && (
              <div className="grp-ungrouped">
                <div className="ch-row ch-wrap ch-gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn text small"
                    style={{ padding: '2px 0', minHeight: 28 }}
                    onClick={() => setShowUngrouped(!showUngrouped)}
                  >
                    {`Ungrouped (${ungroupedEntries.length}) ${showUngrouped ? '▴' : '▾'}`}
                  </button>
                  {manage && (
                    <button
                      type="button"
                      className="btn outline small"
                      disabled={run.busy}
                      onClick={() => setConfirmAutoAssign(true)}
                    >
                      Auto-assign
                    </button>
                  )}
                </div>
                {showUngrouped && (
                  <div className="poll-chips" style={{ marginTop: 6 }}>
                    {ungroupedEntries.map((entry) =>
                      manage ? (
                        <button
                          key={entry.uid}
                          type="button"
                          className="poll-name-chip grp-assignable"
                          onClick={() => setAssigningMember(entry)}
                        >
                          <span>{entry.name}</span>
                          {grouping.shared && entry.tag && (
                            <>
                              {' '}
                              <span className="grp-sec-tag" style={tagStyleForClass(state, grouping, entry.classId)}>
                                {entry.tag}
                              </span>
                            </>
                          )}
                          {' +'}
                        </button>
                      ) : (
                        <span key={entry.uid} className="poll-name-chip">
                          {entry.name}
                          {grouping.shared && entry.tag && (
                            <>
                              {' '}
                              <span className="grp-sec-tag" style={tagStyleForClass(state, grouping, entry.classId)}>
                                {entry.tag}
                              </span>
                            </>
                          )}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="ch-row ch-gap-2" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: -4 }}>
              <button
                type="button"
                className="btn text small"
                style={{ padding: '2px 4px', minHeight: 24 }}
                onClick={() => void copyList()}
              >
                Copy list
              </button>
              {grouping.groups.length > 1 && (
                <button
                  type="button"
                  className="btn text small"
                  style={{ padding: '2px 4px', minHeight: 24 }}
                  onClick={() => setAllSlots(!allOpen)}
                >
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>

            <div className="groupings-grid">
              {grouping.groups.map((slot) => (
                <GroupSlotCard
                  key={slot.id}
                  state={state}
                  grouping={grouping}
                  slot={slot}
                  expanded={isSlotOpen(slot)}
                  onToggleExpanded={() => toggleSlot(slot)}
                  memberById={memberById}
                  isMyGroup={myGroup?.id === slot.id}
                  hasMyGroup={!!myGroup}
                  myPendingGroupName={myPendingGroup?.name ?? ''}
                  canSelfEdit={canSelfEdit}
                  manage={manage}
                  busy={run.busy}
                  onJoin={() =>
                    run(`Joined ${slot.name}.`, () =>
                      joinGroup(db, state.classId, grouping.id, state.myUid, slot.id, false, grouping.shared, metaForUid(state.myUid)),
                    )
                  }
                  onRequestJoin={() =>
                    run(`Requested to join ${slot.name}.`, () =>
                      requestJoinGroup(db, state.classId, grouping.id, slot.id, state.myUid, myName, mySectionTag, grouping.shared),
                    )
                  }
                  onCancelRequest={() =>
                    run('Request cancelled.', () =>
                      cancelJoinRequest(db, state.classId, grouping.id, slot.id, state.myUid, grouping.shared),
                    )
                  }
                  onApproveRequest={(uid, name) =>
                    run(`Approved ${name}.`, () =>
                      approveJoinRequest(db, state.classId, grouping.id, slot.id, state.myUid, uid, manage, grouping.shared),
                    )
                  }
                  onRejectRequest={(uid, name) =>
                    run(`Rejected ${name}.`, () =>
                      rejectJoinRequest(db, state.classId, grouping.id, slot.id, state.myUid, uid, manage, grouping.shared),
                    )
                  }
                  onLeave={() => setConfirmLeaveSlot(slot)}
                  onRemoveMember={(uid, label) =>
                    setConfirmRemove({ kind: 'member', uid, name: label, slotName: slot.name })
                  }
                  onAddGuest={(name, tag, onDone) =>
                    run(
                      `Added ${name.trim()} to ${slot.name}.`,
                      () => addGuestTeammate(db, state.classId, grouping.id, slot.id, state.myUid, name, tag, manage, grouping.shared),
                      onDone,
                    )
                  }
                  onRemoveGuest={(guestId, guestName) =>
                    setConfirmRemove({ kind: 'guest', slotId: slot.id, guestId, name: guestName, slotName: slot.name })
                  }
                  onPassLeader={() => setPassingSlot(slot)}
                  onEditSlot={() => setEditingSlot(slot)}
                  onAssign={() => setAssigningSlot(slot)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {sharingOpen && grouping.shared && (
        <ShareLinkedDialog state={state} grouping={grouping} onClose={() => setSharingOpen(false)} />
      )}
      {addingSlot && (
        <AddSlotDialog classId={state.classId} grouping={grouping} onClose={() => setAddingSlot(false)} />
      )}
      {editingSlot && (
        <EditSlotDialog classId={state.classId} grouping={grouping} slot={editingSlot} onClose={() => setEditingSlot(null)} />
      )}
      {passingSlot && (
        <PassLeaderDialog
          state={state}
          grouping={grouping}
          slot={passingSlot}
          memberById={memberById}
          manage={manage}
          onClose={() => setPassingSlot(null)}
        />
      )}
      {assigningSlot && (
        <AssignToSlotDialog
          state={state}
          grouping={grouping}
          slot={assigningSlot}
          combinedEligible={combinedEligible}
          metaForUid={metaForUid}
          onClose={() => setAssigningSlot(null)}
        />
      )}
      {assigningMember && (
        <PickGroupForMemberDialog
          classId={state.classId}
          grouping={grouping}
          memberName={assigningMember.name}
          memberUid={assigningMember.uid}
          meta={metaForUid(assigningMember.uid)}
          onClose={() => setAssigningMember(null)}
        />
      )}
      {confirmLeaveSlot && (
        <ConfirmDialog
          title={`Leave ${confirmLeaveSlot.name}?`}
          text={
            grouping.hasLeader && effectiveLeaderUid(confirmLeaveSlot, true) === state.myUid && confirmLeaveSlot.memberUids.length > 1
              ? 'Leadership will pass to the next member in this group.'
              : grouping.hasLeader
                ? 'You will need leader approval to rejoin this group.'
                : 'You will be moved back to Ungrouped.'
          }
          confirm="Leave"
          danger
          onClose={() => setConfirmLeaveSlot(null)}
          onConfirm={() =>
            run(
              `Left ${confirmLeaveSlot.name}.`,
              () => leaveGroup(db, state.classId, grouping.id, state.myUid, false, grouping.shared),
              () => setConfirmLeaveSlot(null),
            )
          }
        />
      )}
      {confirmAutoAssign && (
        <ConfirmDialog
          title={`Auto-assign ${ungroupedEntries.length} ungrouped student${ungroupedEntries.length === 1 ? '' : 's'}?`}
          text="They will be evenly placed into groups with open spots."
          confirm="Auto-assign"
          onClose={() => setConfirmAutoAssign(false)}
          onConfirm={() =>
            run(
              'Assigned ungrouped members.',
              async () => {
                const n = await autoAssignUngrouped(
                  db,
                  state.classId,
                  grouping.id,
                  ungroupedIds,
                  grouping.shared,
                  metaForUid,
                );
                if (n === 0) throw new Error('All groups are already full.');
              },
              () => setConfirmAutoAssign(false),
            )
          }
        />
      )}
      {confirmUnlinkSelf && (
        <ConfirmDialog
          title={`Unlink "${grouping.title}" from this class?`}
          text="This class will stop seeing this shared grouping. You can link it again later with its share code."
          confirm="Unlink"
          danger
          onClose={() => setConfirmUnlinkSelf(false)}
          onConfirm={() =>
            run(
              'Unlinked grouping.',
              () => unlinkSharedGrouping(db, state.myUid, state.classId, grouping, state.classId),
              () => setConfirmUnlinkSelf(false),
            )
          }
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${confirmRemove.name} from ${confirmRemove.slotName}?`}
          text={
            confirmRemove.kind === 'member'
              ? 'They will be moved back to Ungrouped.'
              : 'This guest teammate will be removed from the group.'
          }
          confirm="Remove"
          danger
          onClose={() => setConfirmRemove(null)}
          onConfirm={() => {
            if (confirmRemove.kind === 'member') {
              run(
                `Removed ${confirmRemove.name} from ${confirmRemove.slotName}.`,
                () => leaveGroup(db, state.classId, grouping.id, confirmRemove.uid, true, grouping.shared),
                () => setConfirmRemove(null),
              );
            } else {
              run(
                `Removed ${confirmRemove.name}.`,
                () =>
                  removeGuestTeammate(
                    db,
                    state.classId,
                    grouping.id,
                    confirmRemove.slotId,
                    confirmRemove.guestId,
                    state.myUid,
                    manage,
                    grouping.shared,
                  ),
                () => setConfirmRemove(null),
              );
            }
          }}
        />
      )}
    </Card>
  );
}

function GroupSlotCard({
  state,
  grouping,
  slot,
  expanded,
  onToggleExpanded,
  memberById,
  isMyGroup,
  hasMyGroup,
  myPendingGroupName,
  canSelfEdit,
  manage,
  busy,
  onJoin,
  onRequestJoin,
  onCancelRequest,
  onApproveRequest,
  onRejectRequest,
  onLeave,
  onRemoveMember,
  onAddGuest,
  onRemoveGuest,
  onPassLeader,
  onEditSlot,
  onAssign,
}: {
  state: ClassState;
  grouping: Grouping;
  slot: GroupSlot;
  expanded: boolean;
  onToggleExpanded: () => void;
  memberById: Map<string, ClassState['members'][number]>;
  isMyGroup: boolean;
  hasMyGroup: boolean;
  myPendingGroupName: string;
  canSelfEdit: boolean;
  manage: boolean;
  busy: boolean;
  onJoin: () => void;
  onRequestJoin: () => void;
  onCancelRequest: () => void;
  onApproveRequest: (uid: string, name: string) => void;
  onRejectRequest: (uid: string, name: string) => void;
  onLeave: () => void;
  onRemoveMember: (uid: string, name: string) => void;
  onAddGuest: (name: string, tag: string, onDone: () => void) => void;
  onRemoveGuest: (guestId: string, name: string) => void;
  onPassLeader: () => void;
  onEditSlot: () => void;
  onAssign: () => void;
}) {
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestTag, setGuestTag] = useState(grouping.shared ? 'Irregular' : '');
  const [customTag, setCustomTag] = useState(false);

  const guestPresets = grouping.shared ? GUEST_TAG_PRESETS_SHARED : GUEST_TAG_PRESETS_LOCAL;
  const count = groupSize(slot);
  const full = isGroupFull(slot);
  const leaderUid = effectiveLeaderUid(slot, grouping.hasLeader);
  const amLeader = !!leaderUid && leaderUid === state.myUid;
  const canDecideRequests = !!grouping.hasLeader && (manage || (!grouping.locked && amLeader));
  const canPassLeader = !!grouping.hasLeader && slot.memberUids.length > 1 && (manage || (!grouping.locked && amLeader));
  const canManageGuests = manage || (canSelfEdit && (grouping.hasLeader ? amLeader : isMyGroup));
  const needsApproval = !!grouping.hasLeader && slot.memberUids.length > 0;
  const pendingReqs = slot.joinRequests ?? [];
  const myPending = pendingReqs.some((r) => r.uid === state.myUid);

  const nameOf = (uid: string) => {
    const m = memberById.get(uid);
    if (m) return listName(m);
    return slot.memberMeta?.[uid]?.name ?? 'Former member';
  };

  const sortedUids = useMemo(() => {
    return [...slot.memberUids].sort((a, b) => {
      if (leaderUid && a === leaderUid) return -1;
      if (leaderUid && b === leaderUid) return 1;
      return nameOf(a).localeCompare(nameOf(b));
    });
  }, [slot.memberUids, memberById, slot.memberMeta, leaderUid]);

  function submitGuest() {
    if (!guestName.trim()) return;
    onAddGuest(guestName, guestTag, () => {
      setGuestName('');
      setGuestTag(grouping.shared ? 'Irregular' : '');
      setCustomTag(false);
      setAddingGuest(false);
    });
  }

  return (
    <div className={'grp-slot' + (isMyGroup ? ' mine' : '')}>
      <div className="grp-slot-head">
        <button
          type="button"
          className="grp-slot-trigger"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
        >
          <span className="bold ellipsis">{slot.name}</span>
          {isMyGroup && <span className="grp-mine-tag">You</span>}
          {canDecideRequests && pendingReqs.length > 0 && !expanded && (
            <span className="grp-req-pill">{`${pendingReqs.length} req`}</span>
          )}
        </button>
        <div className="ch-row ch-gap-1" style={{ alignItems: 'center', flex: 'none' }}>
          <span className={'grp-cap' + (full ? ' full' : '')}>
            {slot.maxSize > 0 ? `${count}/${slot.maxSize}` : `${count}`}
            {full ? ' · Full' : ''}
          </span>
          {expanded && manage && (
            <button
              type="button"
              className="btn text small"
              style={{ padding: '2px 6px', minHeight: 28 }}
              aria-label={`Edit ${slot.name}`}
              onClick={onEditSlot}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className={'grp-chev' + (expanded ? ' open' : '')}
            style={{ border: 0, background: 'none', cursor: 'pointer' }}
            aria-label={expanded ? `Collapse ${slot.name}` : `Expand ${slot.name}`}
            onClick={onToggleExpanded}
          >
            ▾
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="grp-members">
            {sortedUids.length === 0 && slot.guests.length === 0 && (
              <span className="small muted">No members yet.</span>
            )}
            {sortedUids.map((uid) => {
              const label = nameOf(uid);
              const isMe = uid === state.myUid;
              const isLeader = !!leaderUid && uid === leaderUid;
              const meta = slot.memberMeta?.[uid];
              return (
                <span key={uid} className={'grp-chip' + (isMe ? ' me' : '')}>
                  <span className="grp-chip-name">{isMe ? `${label} (you)` : label}</span>
                  {isLeader && <span className="grp-leader-tag">★ Leader</span>}
                  {grouping.shared && meta?.tag && (
                    <span className="grp-sec-tag" style={tagStyleForClass(state, grouping, meta.classId)}>
                      {meta.tag}
                    </span>
                  )}
                  {manage && (
                    <button
                      type="button"
                      className="grp-chip-x"
                      disabled={busy}
                      aria-label={`Remove ${label} from ${slot.name}`}
                      onClick={() => onRemoveMember(uid, label)}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            {slot.guests.map((g) => (
              <span key={g.id} className="grp-chip guest">
                <span className="grp-chip-name">{g.name}</span>
                {g.tag && <span className="grp-guest-tag">{g.tag}</span>}
                {canManageGuests && (
                  <button
                    type="button"
                    className="grp-chip-x"
                    disabled={busy}
                    aria-label={`Remove guest ${g.name} from ${slot.name}`}
                    onClick={() => onRemoveGuest(g.id, g.name)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>

          {canDecideRequests && pendingReqs.length > 0 && (
            <div className="grp-requests">
              <span className="tiny bold muted">{`Join requests (${pendingReqs.length})`}</span>
              {pendingReqs.map((r) => (
                <div key={r.uid} className="grp-req-row">
                  <span className="grp-req-who">
                    <span className="small semibold">{r.name}</span>
                    {grouping.shared && r.tag && (
                      <span className="grp-sec-tag" style={tagStyleForClass(state, grouping, r.classId)}>
                        {r.tag}
                      </span>
                    )}
                  </span>
                  <span className="ch-row ch-gap-1" style={{ flex: 'none' }}>
                    <button
                      type="button"
                      className="btn text small"
                      disabled={busy}
                      onClick={() => onRejectRequest(r.uid, r.name)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn solid small"
                      disabled={busy || (full && !manage)}
                      onClick={() => onApproveRequest(r.uid, r.name)}
                    >
                      Approve
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {addingGuest && (
            <div className="grp-guest-form">
              <input
                className="input"
                value={guestName}
                maxLength={GUEST_NAME_MAX}
                placeholder="Teammate name"
                autoFocus
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitGuest();
                  }
                }}
              />
              <div className="ch-row ch-wrap ch-gap-1" style={{ alignItems: 'center' }}>
                <span className="tiny muted">Tag:</span>
                {guestPresets.map((preset) => {
                  const selected = !customTag && guestTag === preset;
                  return (
                    <button
                      key={preset || 'none'}
                      type="button"
                      className={'chip' + (selected ? ' selected' : '')}
                      style={{ minHeight: 28, padding: '2px 10px', fontSize: 12 }}
                      onClick={() => {
                        setCustomTag(false);
                        setGuestTag(preset);
                      }}
                    >
                      {preset || 'None'}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={'chip' + (customTag ? ' selected' : '')}
                  style={{ minHeight: 28, padding: '2px 10px', fontSize: 12 }}
                  onClick={() => {
                    setCustomTag(true);
                    if ((guestPresets as readonly string[]).includes(guestTag)) setGuestTag('');
                  }}
                >
                  Custom
                </button>
              </div>
              {customTag && (
                <input
                  className="input"
                  value={guestTag}
                  maxLength={GUEST_TAG_MAX}
                  placeholder="Custom tag"
                  onChange={(e) => setGuestTag(e.target.value)}
                />
              )}
              <div className="ch-row ch-gap-2" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn text small" disabled={busy} onClick={() => setAddingGuest(false)}>
                  Cancel
                </button>
                <button type="button" className="btn solid small" disabled={busy || !guestName.trim()} onClick={submitGuest}>
                  Add
                </button>
              </div>
            </div>
          )}

          <div className="grp-slot-actions">
            {canSelfEdit && !isMyGroup && !full && (
              myPending ? (
                <button type="button" className="btn outline small" disabled={busy} onClick={onCancelRequest}>
                  Requested · Cancel
                </button>
              ) : needsApproval ? (
                myPendingGroupName ? (
                  <span className="tiny muted">{`Request pending in ${myPendingGroupName}`}</span>
                ) : (
                  <button type="button" className="btn solid small" disabled={busy} onClick={onRequestJoin}>
                    Request to join
                  </button>
                )
              ) : (
                <button type="button" className="btn solid small" disabled={busy} onClick={onJoin}>
                  {hasMyGroup ? 'Switch here' : 'Join'}
                </button>
              )
            )}
            {canSelfEdit && isMyGroup && (
              <button type="button" className="btn text small" disabled={busy} onClick={onLeave}>
                Leave
              </button>
            )}
            {canPassLeader && (
              <button type="button" className="btn outline small" disabled={busy} onClick={onPassLeader}>
                {amLeader ? 'Pass leader' : 'Set leader'}
              </button>
            )}
            {canManageGuests && (!full || manage) && !addingGuest && (
              <button type="button" className="btn outline small" disabled={busy} onClick={() => setAddingGuest(true)}>
                + Guest
              </button>
            )}
            {manage && (
              <button type="button" className="btn outline small" disabled={busy} onClick={onAssign}>
                + Assign
              </button>
            )}
            {!canSelfEdit && !manage && grouping.locked && isMyGroup && (
              <span className="tiny muted">Locked</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Dialogs

function NewGroupingDialog({ state, onClose }: { state: ClassState; onClose: () => void }) {
  const run = useRun();
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [note, setNote] = useState('');
  const [groupCount, setGroupCount] = useState(4);
  const [defaultMax, setDefaultMax] = useState(10);
  const [customizeSizes, setCustomizeSizes] = useState(false);
  const [customSizes, setCustomSizes] = useState<number[]>([10, 10, 10, 10]);
  const [selfJoin, setSelfJoin] = useState(true);
  const [hasLeader, setHasLeader] = useState(false);
  const [shared, setShared] = useState(false);
  const [sectionTag, setSectionTag] = useState(() => guessSectionTag(state.room?.name ?? ''));

  const safeCount = Math.min(GROUPING_MAX_GROUPS, Math.max(1, Math.trunc(groupCount) || 1));
  const alignedSizes = useMemo(
    () => Array.from({ length: safeCount }, (_, i) => customSizes[i] ?? defaultMax),
    [safeCount, customSizes, defaultMax],
  );

  function setSizeAt(index: number, value: number) {
    const next = [...alignedSizes];
    next[index] = Math.max(0, Math.min(100, Math.trunc(value) || 0));
    setCustomSizes(next);
  }

  function save() {
    if (!title.trim()) return;
    run(
      shared ? 'Shared grouping created.' : 'Grouping created.',
      () =>
        createGrouping(db, state.myUid, state.classId, {
          title,
          courseId,
          note,
          groupCount: safeCount,
          defaultMaxSize: Math.max(0, Math.trunc(defaultMax) || 0),
          customSizes: customizeSizes ? alignedSizes : undefined,
          selfJoin,
          hasLeader,
          shared,
          className: state.room?.name ?? '',
          sectionTag,
          accentColor: state.room?.accentColor ?? '',
          roster: shared
            ? byLastName(
                courseId ? state.members.filter((m) => !m.excludedCourseIds.includes(courseId)) : state.members,
              ).map((m) => ({ uid: m.id, name: listName(m) }))
            : undefined,
        }),
      onClose,
    );
  }

  return (
    <Dialog
      title="New grouping"
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn solid" disabled={!title.trim() || run.busy} onClick={save}>
            {run.busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Title">
          <input
            value={title}
            maxLength={GROUPING_TITLE_MAX}
            placeholder="e.g. Final Project Teams"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {state.courses.length > 0 && (
          <Field label="Course">
            <TagSelect state={state} value={courseId} onChange={setCourseId} label="Course" />
          </Field>
        )}
        <Field label="Note (optional)">
          <input
            value={note}
            maxLength={GROUPING_NOTE_MAX}
            placeholder="Optional note"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Groups">
            <input
              type="number"
              min={1}
              max={GROUPING_MAX_GROUPS}
              value={groupCount}
              onChange={(e) => setGroupCount(Number(e.target.value))}
            />
          </Field>
          <Field label="Max per group (0 = no limit)">
            <input
              type="number"
              min={0}
              max={100}
              value={defaultMax}
              onChange={(e) => {
                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                setDefaultMax(v);
                if (!customizeSizes) setCustomSizes(Array.from({ length: safeCount }, () => v));
              }}
            />
          </Field>
        </div>
        <Switch
          checked={customizeSizes}
          onChange={(on) => {
            setCustomizeSizes(on);
            if (on) setCustomSizes(Array.from({ length: safeCount }, () => defaultMax));
          }}
          label="Custom size per group"
        />
        {customizeSizes && (
          <div className="grp-size-grid">
            {alignedSizes.map((sz, i) => (
              <label key={i} className="grp-size-item">
                <span className="tiny muted">{`Group ${i + 1}`}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={sz}
                  onChange={(e) => setSizeAt(i, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        )}
        <Switch checked={selfJoin} onChange={setSelfJoin} label="Allow self-join" />
        <Switch
          checked={hasLeader}
          onChange={setHasLeader}
          label="Group leaders"
          description="First to join leads and approves new members."
        />
        <Switch checked={shared} onChange={setShared} label="Share with another class" />
        {shared && (
          <Field label="Section tag">
            <input
              value={sectionTag}
              maxLength={GUEST_TAG_MAX}
              placeholder="e.g. G1"
              onChange={(e) => setSectionTag(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function LinkSharedGroupingDialog({ state, onClose }: { state: ClassState; onClose: () => void }) {
  const run = useRun();
  const [code, setCode] = useState('');
  const [sectionTag, setSectionTag] = useState(() => guessSectionTag(state.room?.name ?? ''));
  const [courseId, setCourseId] = useState('');

  return (
    <Dialog
      title="Link with code"
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn solid"
            disabled={!code.trim() || run.busy}
            onClick={() =>
              run(
                'Shared grouping linked.',
                () =>
                  linkSharedGrouping(
                    db,
                    state.myUid,
                    state.classId,
                    state.room?.name ?? '',
                    code,
                    sectionTag,
                    courseId,
                    state.room?.accentColor ?? '',
                    byLastName(
                      courseId ? state.members.filter((m) => !m.excludedCourseIds.includes(courseId)) : state.members,
                    ).map((m) => ({ uid: m.id, name: listName(m) })),
                  ),
                onClose,
              )
            }
          >
            {run.busy ? 'Linking…' : 'Link'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Share code">
          <input
            value={code}
            maxLength={24}
            placeholder="GRP-4829"
            style={{ textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 }}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field label="Section tag">
          <input
            value={sectionTag}
            maxLength={GUEST_TAG_MAX}
            placeholder="e.g. G2"
            onChange={(e) => setSectionTag(e.target.value)}
          />
        </Field>
        {state.courses.length > 0 && (
          <Field label="Course (optional)">
            <TagSelect state={state} value={courseId} onChange={setCourseId} label="Course" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function ShareLinkedDialog({
  state,
  grouping,
  onClose,
}: {
  state: ClassState;
  grouping: Grouping;
  onClose: () => void;
}) {
  const { actions } = useClass();
  const run = useRun();
  const [unlinking, setUnlinking] = useState<{ classId: string; name: string } | null>(null);
  const isHost = grouping.hostClassId === state.classId;
  const linked = (grouping.linkedClassIds ?? []).map((cid, idx) => ({
    classId: cid,
    isHost: cid === grouping.hostClassId,
    ...(grouping.linkedClasses?.[cid] ?? { name: cid, tag: `S${idx + 1}`, courseId: '' }),
  }));

  async function copyCode() {
    if (!grouping.shareCode) return;
    try {
      await navigator.clipboard.writeText(grouping.shareCode);
      actions.showNotice('Share code copied.');
    } catch {
      actions.showNotice('Could not copy code.');
    }
  }

  return (
    <Dialog
      title="Share & linked classes"
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          {grouping.shareCode && (
            <button type="button" className="btn outline" onClick={() => void copyCode()}>
              Copy code
            </button>
          )}
          <button type="button" className="btn solid" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="stack">
        {grouping.shareCode && <div className="grp-code-hero">{grouping.shareCode}</div>}
        <div className="small bold">{`Linked (${linked.length}/${SHARED_MAX_CLASSES})`}</div>
        <div className="stack" style={{ gap: 6 }}>
          {linked.map((c) => (
            <div key={c.classId} className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', borderRadius: 10, background: 'var(--ch-surface-2)' }}>
              <span className="ch-row ch-gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
                <span className="bold small ellipsis">{c.name}</span>
                <span className="grp-sec-tag" style={tagStyleForClass(state, grouping, c.classId)}>
                  {c.tag}
                </span>
              </span>
              {c.isHost ? (
                <span className="tiny muted">Host</span>
              ) : isHost || c.classId === state.classId ? (
                <button
                  type="button"
                  className="btn text small danger"
                  disabled={run.busy}
                  onClick={() => setUnlinking({ classId: c.classId, name: c.name })}
                >
                  Unlink
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {unlinking && (
        <ConfirmDialog
          title={`Unlink ${unlinking.name}?`}
          text={`${unlinking.name} will stop seeing this shared grouping.`}
          confirm="Unlink"
          danger
          onClose={() => setUnlinking(null)}
          onConfirm={() =>
            run(
              `Unlinked ${unlinking.name}.`,
              () => unlinkSharedGrouping(db, state.myUid, state.classId, grouping, unlinking.classId),
              () => setUnlinking(null),
            )
          }
        />
      )}
    </Dialog>
  );
}

function PassLeaderDialog({
  state,
  grouping,
  slot,
  memberById,
  manage,
  onClose,
}: {
  state: ClassState;
  grouping: Grouping;
  slot: GroupSlot;
  memberById: Map<string, ClassState['members'][number]>;
  manage: boolean;
  onClose: () => void;
}) {
  const run = useRun();
  const currentLeader = effectiveLeaderUid(slot, true);
  const candidates = slot.memberUids.filter((uid) => uid !== currentLeader);
  const nameOf = (uid: string) => {
    const m = memberById.get(uid);
    return m ? listName(m) : slot.memberMeta?.[uid]?.name ?? 'Member';
  };

  return (
    <Dialog
      title={`Leader for ${slot.name}`}
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <button type="button" className="btn text" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="stack" style={{ gap: 8 }}>
        {candidates.map((uid) => {
          const name = nameOf(uid);
          return (
            <button
              key={uid}
              type="button"
              className="option-card"
              disabled={run.busy}
              onClick={() =>
                run(
                  `${name} is now leader of ${slot.name}.`,
                  () => setGroupLeader(db, state.classId, grouping.id, slot.id, state.myUid, uid, manage, grouping.shared),
                  onClose,
                )
              }
            >
              <span className="grow bold" style={{ overflowWrap: 'anywhere' }}>{name}</span>
              <span className="small semibold" style={{ color: 'var(--primary)', flex: 'none' }}>
                Make leader
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

function EditGroupingDialog({ state, grouping, onClose }: { state: ClassState; grouping: Grouping; onClose: () => void }) {
  const run = useRun();
  const isHost = !grouping.shared || grouping.hostClassId === state.classId;
  const [title, setTitle] = useState(grouping.title);
  const [courseId, setCourseId] = useState(grouping.courseId);
  const [note, setNote] = useState(grouping.note);
  const [selfJoin, setSelfJoin] = useState(grouping.selfJoin);
  const [hasLeader, setHasLeader] = useState(!!grouping.hasLeader);
  const [shared, setShared] = useState(!!grouping.shared);
  const [sectionTag, setSectionTag] = useState(
    () => grouping.linkedClasses?.[state.classId]?.tag ?? guessSectionTag(state.room?.name ?? ''),
  );

  const memberById = useMemo(() => new Map(state.members.map((m) => [m.id, m])), [state.members]);
  const hasPartnerClasses = !!grouping.shared && (grouping.linkedClassIds?.length ?? 0) > 1;

  function save() {
    if (!title.trim()) return;
    const roster = byLastName(
      courseId ? state.members.filter((m) => !m.excludedCourseIds.includes(courseId)) : state.members,
    ).map((m) => ({ uid: m.id, name: listName(m) }));

    if (!grouping.shared && shared) {
      run(
        'Sharing turned on.',
        () =>
          enableGroupingSharing(db, state.myUid, state.classId, grouping, {
            title,
            courseId,
            note,
            selfJoin,
            hasLeader,
            className: state.room?.name ?? '',
            sectionTag,
            accentColor: state.room?.accentColor ?? '',
            roster,
            memberNameOf: (uid) => {
              const m = memberById.get(uid);
              return m ? listName(m) : 'Member';
            },
          }),
        onClose,
      );
      return;
    }

    if (grouping.shared && !shared && isHost) {
      run(
        'Sharing turned off.',
        () =>
          disableGroupingSharing(db, state.myUid, state.classId, grouping, {
            title,
            courseId,
            note,
            selfJoin,
            hasLeader,
            localMemberIds: new Set(state.members.map((m) => m.id)),
          }),
        onClose,
      );
      return;
    }

    run(
      'Grouping updated.',
      () => updateGroupingMeta(db, state.myUid, state.classId, grouping, { title, courseId, note, selfJoin, hasLeader, roster }),
      onClose,
    );
  }

  return (
    <Dialog
      title="Edit grouping"
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn solid"
            disabled={!title.trim() || run.busy}
            onClick={save}
          >
            {run.busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Title">
          <input value={title} maxLength={GROUPING_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {state.courses.length > 0 && (
          <Field label="Course">
            <TagSelect state={state} value={courseId} onChange={setCourseId} label="Course" />
          </Field>
        )}
        <Field label="Note (optional)">
          <input value={note} maxLength={GROUPING_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Switch checked={selfJoin} onChange={setSelfJoin} label="Allow self-join" />
        <Switch
          checked={hasLeader}
          onChange={setHasLeader}
          label="Group leaders"
          description="First to join leads and approves new members."
        />
        {isHost && (
          <>
            <Switch
              checked={shared}
              onChange={setShared}
              label="Share with another class"
              description={
                grouping.shared && !shared && hasPartnerClasses
                  ? 'Linked partner classes will be unlinked.'
                  : undefined
              }
            />
            {!grouping.shared && shared && (
              <Field label="Section tag">
                <input
                  value={sectionTag}
                  maxLength={GUEST_TAG_MAX}
                  placeholder="e.g. G1"
                  onChange={(e) => setSectionTag(e.target.value)}
                />
              </Field>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function AddSlotDialog({ classId, grouping, onClose }: { classId: string; grouping: Grouping; onClose: () => void }) {
  const run = useRun();
  const defaultCap = grouping.groups[0]?.maxSize ?? 0;
  const [name, setName] = useState(`Group ${grouping.groups.length + 1}`);
  const [maxSize, setMaxSize] = useState(defaultCap);

  return (
    <Dialog
      title="Add a group"
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn solid"
            disabled={!name.trim() || run.busy}
            onClick={() =>
              run(`Added ${name.trim()}.`, () => addGroupSlot(db, classId, grouping.id, name, maxSize, grouping.shared), onClose)
            }
          >
            Add
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Group name">
          <input value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Max size (0 = no limit)">
          <input type="number" min={0} max={100} value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} />
        </Field>
      </div>
    </Dialog>
  );
}

function EditSlotDialog({
  classId,
  grouping,
  slot,
  onClose,
}: {
  classId: string;
  grouping: Grouping;
  slot: GroupSlot;
  onClose: () => void;
}) {
  const run = useRun();
  const [name, setName] = useState(slot.name);
  const [maxSize, setMaxSize] = useState(slot.maxSize);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (confirmDelete) {
    return (
      <ConfirmDialog
        title={`Delete ${slot.name}?`}
        text="Members in this group will become ungrouped, and its guest teammates will be removed."
        confirm="Delete"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(`Removed ${slot.name}.`, () => deleteGroupSlot(db, classId, grouping.id, slot.id, grouping.shared), onClose)
        }
      />
    );
  }

  return (
    <Dialog
      title={`Edit ${slot.name}`}
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          {grouping.groups.length > 1 && (
            <button
              type="button"
              className="btn text danger"
              style={{ marginRight: 'auto' }}
              disabled={run.busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn solid"
            disabled={!name.trim() || run.busy}
            onClick={() =>
              run('Group updated.', () => editGroupSlot(db, classId, grouping.id, slot.id, name, maxSize, grouping.shared), onClose)
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Group name">
          <input value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Max size (0 = no limit)">
          <input type="number" min={0} max={100} value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} />
        </Field>
      </div>
    </Dialog>
  );
}

function AssignToSlotDialog({
  state,
  grouping,
  slot,
  combinedEligible,
  metaForUid,
  onClose,
}: {
  state: ClassState;
  grouping: Grouping;
  slot: GroupSlot;
  combinedEligible: { uid: string; name: string; classId: string; tag: string }[];
  metaForUid: (uid: string) => MemberMeta | undefined;
  onClose: () => void;
}) {
  const run = useRun();
  const [search, setSearch] = useState('');
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const candidates = useMemo(() => {
    const notHere = combinedEligible.filter((m) => !slot.memberUids.includes(m.uid));
    const filtered = words.length
      ? notHere.filter((m) => {
          const hay = `${m.name} ${m.tag}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : notHere;
    return [...filtered].sort((a, b) => {
      const ga = findMemberGroup(grouping.groups, a.uid) ? 1 : 0;
      const gb = findMemberGroup(grouping.groups, b.uid) ? 1 : 0;
      return ga - gb;
    });
  }, [combinedEligible, slot.memberUids, words, grouping.groups]);

  return (
    <Dialog
      title={`Assign to ${slot.name}`}
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <button type="button" className="btn text" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="stack">
        <SearchInput aria-label="Search students" placeholder="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="scroll-list">
          {candidates.length === 0 && <p className="empty" style={{ padding: 16 }}>No students left.</p>}
          {candidates.map((m) => {
            const current = findMemberGroup(grouping.groups, m.uid);
            return (
              <button
                key={m.uid}
                type="button"
                className="list-row"
                disabled={run.busy}
                onClick={() =>
                  run(`Assigned ${m.name} to ${slot.name}.`, () =>
                    joinGroup(db, state.classId, grouping.id, m.uid, slot.id, true, grouping.shared, metaForUid(m.uid)),
                  )
                }
              >
                <span className="grow ellipsis-box">
                  <span className="title ellipsis">
                    {m.name}
                    {grouping.shared && m.tag && (
                      <>
                        {' '}
                        <span className="grp-sec-tag" style={tagStyleForClass(state, grouping, m.classId)}>
                          {m.tag}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="sub ellipsis">{current ? `In ${current.name}` : 'Ungrouped'}</span>
                </span>
                <span className="small semibold" style={{ color: 'var(--primary)' }}>
                  Add
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

function PickGroupForMemberDialog({
  classId,
  grouping,
  memberName,
  memberUid,
  meta,
  onClose,
}: {
  classId: string;
  grouping: Grouping;
  memberName: string;
  memberUid: string;
  meta?: MemberMeta;
  onClose: () => void;
}) {
  const run = useRun();
  return (
    <Dialog
      title={`Assign ${memberName}`}
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <button type="button" className="btn text" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="stack" style={{ gap: 8 }}>
        {grouping.groups.map((slot) => {
          const count = groupSize(slot);
          const full = isGroupFull(slot);
          return (
            <button
              key={slot.id}
              type="button"
              className="option-card"
              disabled={run.busy}
              onClick={() =>
                run(
                  `Assigned ${memberName} to ${slot.name}.`,
                  () => joinGroup(db, classId, grouping.id, memberUid, slot.id, true, grouping.shared, meta),
                  onClose,
                )
              }
            >
              <span className="grow bold">{slot.name}</span>
              <span className={'small semibold ' + (full ? 'error-text' : 'muted')}>
                {slot.maxSize > 0 ? `${count}/${slot.maxSize}` : `${count}`}
                {full ? ' · Full' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

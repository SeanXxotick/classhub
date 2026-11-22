/*
 * Project & Lab Groupings (inside the Members tab):
 * Supports per-group capacities (e.g. 10 and 11 in the same grouping),
 * guest teammates from other sections (G2) or irregulars, self-join with officer lock,
 * ungrouped tracking, auto-assign, and one-tap plain-text export.
 */
import { useMemo, useRef, useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { byLastName, listName } from '../../data/models';
import {
  GROUPING_MAX_GROUPS,
  GROUPING_NOTE_MAX,
  GROUPING_TITLE_MAX,
  GROUP_NAME_MAX,
  GUEST_NAME_MAX,
  GUEST_TAG_MAX,
  addGroupSlot,
  addGuestTeammate,
  autoAssignUngrouped,
  createGrouping,
  deleteGroupSlot,
  deleteGrouping,
  editGroupSlot,
  joinGroup,
  leaveGroup,
  removeGuestTeammate,
  setGroupingLocked,
  updateGroupingMeta,
  useGroupings,
  type GroupSlot,
  type Grouping,
} from '../../data/groupings';
import {
  findMemberGroup,
  formatGroupingExport,
  groupSize,
  isGroupFull,
  ungroupedMemberIds,
} from '../../domain/groupingLogic';
import { Badge, Button, Card, Notice, SearchInput, Switch } from '../../design';
import { ConfirmDialog, Dialog, Field } from '../common';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { MoreMenu } from '../MoreMenu';
import { TagBadge, TagSelect } from './ForumUi';

const GUEST_TAG_PRESETS = ['', 'G2', 'Irregular'] as const;

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
        <div className="ch-row">
          <Button icon="plus" onClick={() => setCreating(true)}>
            New grouping
          </Button>
        </div>
      )}
      {(groupings ?? []).length > 0 && state.courses.length > 0 && (
        <div className="forum-search">
          <TagSelect state={state} value={tag} onChange={setTag} label="Course" all />
        </div>
      )}
      {groupings && visible.length === 0 && (
        <Notice tone="info">
          {tag === '*'
            ? manage
              ? 'No groupings yet. Create one for a project, lab, or reporting activity.'
              : 'No groupings yet.'
            : 'No groupings for this course.'}
        </Notice>
      )}
      {visible.map((grouping) => (
        <GroupingCard
          key={grouping.id}
          state={state}
          grouping={grouping}
          manage={manage}
          onEdit={() => setEditing(grouping)}
          onToggleLock={() =>
            run(
              grouping.locked ? 'Grouping unlocked.' : 'Grouping locked.',
              () => setGroupingLocked(db, state.myUid, state.classId, grouping, !grouping.locked),
            )
          }
          onDelete={() => setDeleting(grouping)}
        />
      ))}
      {creating && <NewGroupingDialog state={state} onClose={() => setCreating(false)} />}
      {editing && <EditGroupingDialog state={state} grouping={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          text="All groups and guest teammates in this grouping will be removed for everyone in the class."
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
  manage,
  onEdit,
  onToggleLock,
  onDelete,
}: {
  state: ClassState;
  grouping: Grouping;
  manage: boolean;
  onEdit: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  const { actions } = useClass();
  const run = useRun();
  const [showUngrouped, setShowUngrouped] = useState(false);
  const [addingSlot, setAddingSlot] = useState(false);
  const [editingSlot, setEditingSlot] = useState<GroupSlot | null>(null);
  const [assigningSlot, setAssigningSlot] = useState<GroupSlot | null>(null);
  const [assigningMemberUid, setAssigningMemberUid] = useState<string | null>(null);

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
  const ungroupedIds = useMemo(
    () => ungroupedMemberIds(grouping.groups, eligibleMembers.map((m) => m.id)),
    [grouping.groups, eligibleMembers],
  );
  const ungroupedMembers = useMemo(
    () => ungroupedIds.map((id) => memberById.get(id)).filter((m): m is NonNullable<typeof m> => !!m),
    [ungroupedIds, memberById],
  );

  const myGroup = findMemberGroup(grouping.groups, state.myUid);
  const canSelfEdit = grouping.selfJoin && !grouping.locked;
  const totalMembers = grouping.groups.reduce((sum, g) => sum + g.memberUids.length, 0);
  const totalGuests = grouping.groups.reduce((sum, g) => sum + g.guests.length, 0);
  const courseName = grouping.courseId ? state.courses.find((c) => c.id === grouping.courseId)?.name ?? '' : '';

  async function copyList() {
    const text = formatGroupingExport(grouping, courseName, (uid) => {
      const m = memberById.get(uid);
      return m ? listName(m) : 'Former member';
    });
    try {
      await navigator.clipboard.writeText(text);
      actions.showNotice('Group list copied.');
    } catch {
      actions.showNotice('Could not copy to clipboard.');
    }
  }

  return (
    <Card>
      <div className="stack" style={{ gap: 12 }}>
        <div className="card-head">
          <div className="stack" style={{ gap: 6 }}>
            <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
              <TagBadge state={state} courseId={grouping.courseId} />
              {grouping.locked ? (
                <Badge tone="warning">Locked</Badge>
              ) : grouping.selfJoin ? (
                <Badge tone="success">Self-join open</Badge>
              ) : (
                <Badge tone="neutral">Officer-assigned</Badge>
              )}
              {myGroup && <Badge tone="primary">{`You: ${myGroup.name}`}</Badge>}
            </div>
            <div className="bold" style={{ fontSize: 17, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {grouping.title}
            </div>
            {grouping.note && <div className="small muted">{grouping.note}</div>}
            <div className="ch-small ch-muted">
              {`${grouping.groups.length} group${grouping.groups.length === 1 ? '' : 's'} · ${totalMembers} member${totalMembers === 1 ? '' : 's'}`}
              {totalGuests > 0 ? ` · ${totalGuests} guest${totalGuests === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <div className="ch-row ch-gap-1" style={{ alignItems: 'center' }}>
            <button type="button" className="btn outline small" onClick={() => void copyList()}>
              Copy list
            </button>
            <MoreMenu
              label={`More for "${grouping.title}"`}
              title={grouping.title}
              items={[
                { label: 'Copy group list', icon: 'list', onClick: () => void copyList() },
                manage && { label: grouping.locked ? 'Unlock grouping' : 'Lock grouping', icon: 'lock', onClick: onToggleLock },
                manage && { label: 'Add a group', icon: 'plus', onClick: () => setAddingSlot(true) },
                manage && { label: 'Edit details', icon: 'edit', onClick: onEdit },
                manage && { label: 'Delete', icon: 'trash', danger: true, onClick: onDelete },
              ]}
            />
          </div>
        </div>

        {ungroupedMembers.length > 0 && (
          <div className="grp-ungrouped">
            <div className="ch-row ch-wrap ch-gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn text small"
                style={{ padding: '2px 0', minHeight: 28 }}
                onClick={() => setShowUngrouped(!showUngrouped)}
              >
                {`Ungrouped (${ungroupedMembers.length}) ${showUngrouped ? '▴' : '▾'}`}
              </button>
              {manage && (
                <button
                  type="button"
                  className="btn outline small"
                  disabled={run.busy}
                  onClick={() =>
                    run(
                      'Assigned ungrouped members.',
                      async () => {
                        const n = await autoAssignUngrouped(db, state.classId, grouping.id, ungroupedIds);
                        if (n === 0) throw new Error('All groups are already full.');
                      },
                    )
                  }
                >
                  Auto-assign
                </button>
              )}
            </div>
            {showUngrouped && (
              <div className="poll-chips" style={{ marginTop: 6 }}>
                {ungroupedMembers.map((m) =>
                  manage ? (
                    <button
                      key={m.id}
                      type="button"
                      className="poll-name-chip grp-assignable"
                      title={`Assign ${m.name} to a group`}
                      onClick={() => setAssigningMemberUid(m.id)}
                    >
                      {listName(m)} +
                    </button>
                  ) : (
                    <span key={m.id} className="poll-name-chip">
                      {listName(m)}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        )}

        <div className="groupings-grid">
          {grouping.groups.map((slot) => (
            <GroupSlotCard
              key={slot.id}
              state={state}
              grouping={grouping}
              slot={slot}
              memberById={memberById}
              isMyGroup={myGroup?.id === slot.id}
              hasMyGroup={!!myGroup}
              canSelfEdit={canSelfEdit}
              manage={manage}
              busy={run.busy}
              onJoin={() => run(`Joined ${slot.name}.`, () => joinGroup(db, state.classId, grouping.id, state.myUid, slot.id, false))}
              onLeave={() => run(`Left ${slot.name}.`, () => leaveGroup(db, state.classId, grouping.id, state.myUid, false))}
              onRemoveMember={(uid) =>
                run('Removed from group.', () => leaveGroup(db, state.classId, grouping.id, uid, true))
              }
              onAddGuest={(name, tag, onDone) =>
                run(
                  `Added ${name.trim()} to ${slot.name}.`,
                  () => addGuestTeammate(db, state.classId, grouping.id, slot.id, state.myUid, name, tag, manage),
                  onDone,
                )
              }
              onRemoveGuest={(guestId) =>
                run('Removed guest teammate.', () =>
                  removeGuestTeammate(db, state.classId, grouping.id, slot.id, guestId, state.myUid, manage),
                )
              }
              onEditSlot={() => setEditingSlot(slot)}
              onAssign={() => setAssigningSlot(slot)}
            />
          ))}
        </div>
      </div>

      {addingSlot && (
        <AddSlotDialog
          classId={state.classId}
          grouping={grouping}
          onClose={() => setAddingSlot(false)}
        />
      )}
      {editingSlot && (
        <EditSlotDialog
          classId={state.classId}
          grouping={grouping}
          slot={editingSlot}
          onClose={() => setEditingSlot(null)}
        />
      )}
      {assigningSlot && (
        <AssignToSlotDialog
          state={state}
          grouping={grouping}
          slot={assigningSlot}
          eligibleMembers={eligibleMembers}
          onClose={() => setAssigningSlot(null)}
        />
      )}
      {assigningMemberUid && (
        <PickGroupForMemberDialog
          classId={state.classId}
          grouping={grouping}
          memberName={memberById.get(assigningMemberUid)?.name ?? 'Student'}
          memberUid={assigningMemberUid}
          onClose={() => setAssigningMemberUid(null)}
        />
      )}
    </Card>
  );
}

function GroupSlotCard({
  state,
  grouping,
  slot,
  memberById,
  isMyGroup,
  hasMyGroup,
  canSelfEdit,
  manage,
  busy,
  onJoin,
  onLeave,
  onRemoveMember,
  onAddGuest,
  onRemoveGuest,
  onEditSlot,
  onAssign,
}: {
  state: ClassState;
  grouping: Grouping;
  slot: GroupSlot;
  memberById: Map<string, ClassState['members'][number]>;
  isMyGroup: boolean;
  hasMyGroup: boolean;
  canSelfEdit: boolean;
  manage: boolean;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onRemoveMember: (uid: string) => void;
  onAddGuest: (name: string, tag: string, onDone: () => void) => void;
  onRemoveGuest: (guestId: string) => void;
  onEditSlot: () => void;
  onAssign: () => void;
}) {
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestTag, setGuestTag] = useState('');
  const [customTag, setCustomTag] = useState(false);

  const count = groupSize(slot);
  const full = isGroupFull(slot);
  const canManageGuests = manage || (canSelfEdit && isMyGroup);

  const sortedUids = useMemo(() => {
    return [...slot.memberUids].sort((a, b) => {
      const ma = memberById.get(a);
      const mb = memberById.get(b);
      return (ma ? listName(ma) : a).localeCompare(mb ? listName(mb) : b);
    });
  }, [slot.memberUids, memberById]);

  function submitGuest() {
    if (!guestName.trim()) return;
    onAddGuest(guestName, guestTag, () => {
      setGuestName('');
      setGuestTag('');
      setCustomTag(false);
      setAddingGuest(false);
    });
  }

  return (
    <div className={'grp-slot' + (isMyGroup ? ' mine' : '')}>
      <div className="grp-slot-head">
        <div className="ch-row ch-gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
          <span className="bold ellipsis">{slot.name}</span>
          {isMyGroup && <span className="grp-mine-tag">You</span>}
        </div>
        <div className="ch-row ch-gap-1" style={{ alignItems: 'center', flex: 'none' }}>
          <span className={'grp-cap' + (full ? ' full' : '')}>
            {slot.maxSize > 0 ? `${count}/${slot.maxSize}` : `${count}`}
            {full ? ' · Full' : ''}
          </span>
          {manage && (
            <button
              type="button"
              className="btn text small"
              style={{ padding: '2px 6px', minHeight: 28 }}
              aria-label={`Edit ${slot.name}`}
              title="Rename or change max size"
              onClick={onEditSlot}
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="grp-members">
        {sortedUids.length === 0 && slot.guests.length === 0 && (
          <span className="small muted">No members yet.</span>
        )}
        {sortedUids.map((uid) => {
          const m = memberById.get(uid);
          const label = m ? listName(m) : 'Former member';
          const isMe = uid === state.myUid;
          return (
            <span key={uid} className={'grp-chip' + (isMe ? ' me' : '')}>
              <span className="ellipsis">{isMe ? `${label} (you)` : label}</span>
              {manage && (
                <button
                  type="button"
                  className="grp-chip-x"
                  disabled={busy}
                  aria-label={`Remove ${label} from ${slot.name}`}
                  onClick={() => onRemoveMember(uid)}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {slot.guests.map((g) => (
          <span key={g.id} className="grp-chip guest">
            <span className="ellipsis">{g.name}</span>
            {g.tag && <span className="grp-guest-tag">{g.tag}</span>}
            {canManageGuests && (
              <button
                type="button"
                className="grp-chip-x"
                disabled={busy}
                aria-label={`Remove guest ${g.name} from ${slot.name}`}
                onClick={() => onRemoveGuest(g.id)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {addingGuest && (
        <div className="grp-guest-form">
          <input
            className="input"
            value={guestName}
            maxLength={GUEST_NAME_MAX}
            placeholder="Teammate name (e.g. Maria Santos)"
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
            {GUEST_TAG_PRESETS.map((preset) => {
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
                if (GUEST_TAG_PRESETS.includes(guestTag as (typeof GUEST_TAG_PRESETS)[number])) setGuestTag('');
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
              placeholder="e.g. G3 or Cross-enroll"
              onChange={(e) => setGuestTag(e.target.value)}
            />
          )}
          <div className="ch-row ch-gap-2" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn text small" disabled={busy} onClick={() => setAddingGuest(false)}>
              Cancel
            </button>
            <button type="button" className="btn solid small" disabled={busy || !guestName.trim()} onClick={submitGuest}>
              Add guest
            </button>
          </div>
        </div>
      )}

      <div className="grp-slot-actions">
        {canSelfEdit && !isMyGroup && !full && (
          <button type="button" className="btn solid small" disabled={busy} onClick={onJoin}>
            {hasMyGroup ? 'Switch here' : 'Join'}
          </button>
        )}
        {canSelfEdit && isMyGroup && (
          <button type="button" className="btn text small" disabled={busy} onClick={onLeave}>
            Leave
          </button>
        )}
        {canManageGuests && (!full || manage) && !addingGuest && (
          <button type="button" className="btn outline small" disabled={busy} onClick={() => setAddingGuest(true)}>
            + Add guest
          </button>
        )}
        {manage && (
          <button type="button" className="btn outline small" disabled={busy} onClick={onAssign}>
            + Assign
          </button>
        )}
        {!canSelfEdit && !manage && grouping.locked && isMyGroup && (
          <span className="tiny muted">Locked by officer</span>
        )}
      </div>
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
      'Grouping created.',
      () =>
        createGrouping(db, state.myUid, state.classId, {
          title,
          courseId,
          note,
          groupCount: safeCount,
          defaultMaxSize: Math.max(0, Math.trunc(defaultMax) || 0),
          customSizes: customizeSizes ? alignedSizes : undefined,
          selfJoin,
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
            {run.busy ? 'Creating…' : 'Create grouping'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Title">
          <input
            value={title}
            maxLength={GROUPING_TITLE_MAX}
            placeholder="e.g. Final Project Teams or Lab Partners"
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
            placeholder="e.g. Combined G1 + G2 · Groups of 10–11"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Number of groups">
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
          label="Set different max sizes per group"
          description="Handy for uneven totals (e.g. 42 students → two groups of 11 and two of 10)."
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
        <Switch
          checked={selfJoin}
          onChange={setSelfJoin}
          label="Let students join and add guests"
          description="Students can join a group and add G2 or irregular teammates to their own group until you lock it."
        />
      </div>
    </Dialog>
  );
}

function EditGroupingDialog({ state, grouping, onClose }: { state: ClassState; grouping: Grouping; onClose: () => void }) {
  const run = useRun();
  const [title, setTitle] = useState(grouping.title);
  const [courseId, setCourseId] = useState(grouping.courseId);
  const [note, setNote] = useState(grouping.note);
  const [selfJoin, setSelfJoin] = useState(grouping.selfJoin);

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
            onClick={() =>
              run(
                'Grouping updated.',
                () => updateGroupingMeta(db, state.myUid, state.classId, grouping, { title, courseId, note, selfJoin }),
                onClose,
              )
            }
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
        <Switch
          checked={selfJoin}
          onChange={setSelfJoin}
          label="Let students join and add guests"
        />
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
            onClick={() => run(`Added ${name.trim()}.`, () => addGroupSlot(db, classId, grouping.id, name, maxSize), onClose)}
          >
            Add group
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
              onClick={() => run(`Removed ${slot.name}.`, () => deleteGroupSlot(db, classId, grouping.id, slot.id), onClose)}
            >
              Delete group
            </button>
          )}
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn solid"
            disabled={!name.trim() || run.busy}
            onClick={() => run('Group updated.', () => editGroupSlot(db, classId, grouping.id, slot.id, name, maxSize), onClose)}
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
  eligibleMembers,
  onClose,
}: {
  state: ClassState;
  grouping: Grouping;
  slot: GroupSlot;
  eligibleMembers: ClassState['members'];
  onClose: () => void;
}) {
  const run = useRun();
  const [search, setSearch] = useState('');
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const candidates = useMemo(() => {
    const notHere = eligibleMembers.filter((m) => !slot.memberUids.includes(m.id));
    const filtered = words.length
      ? notHere.filter((m) => {
          const hay = `${m.name} ${listName(m)}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : notHere;
    // Ungrouped members first, then those already in another group
    return [...filtered].sort((a, b) => {
      const ga = findMemberGroup(grouping.groups, a.id) ? 1 : 0;
      const gb = findMemberGroup(grouping.groups, b.id) ? 1 : 0;
      return ga - gb;
    });
  }, [eligibleMembers, slot.memberUids, words, grouping.groups]);

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
          {candidates.length === 0 && <p className="empty" style={{ padding: 16 }}>No students left to assign.</p>}
          {candidates.map((m) => {
            const current = findMemberGroup(grouping.groups, m.id);
            return (
              <button
                key={m.id}
                type="button"
                className="list-row"
                disabled={run.busy}
                onClick={() =>
                  run(`Assigned ${m.name} to ${slot.name}.`, () =>
                    joinGroup(db, state.classId, grouping.id, m.id, slot.id, true),
                  )
                }
              >
                <span className="grow ellipsis-box">
                  <span className="title ellipsis">{listName(m)}</span>
                  <span className="sub ellipsis">
                    {current ? `Currently in ${current.name} (will move)` : 'Ungrouped'}
                  </span>
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
  onClose,
}: {
  classId: string;
  grouping: Grouping;
  memberName: string;
  memberUid: string;
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
                run(`Assigned ${memberName} to ${slot.name}.`, () => joinGroup(db, classId, grouping.id, memberUid, slot.id, true), onClose)
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

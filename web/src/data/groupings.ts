/*
 * Project & Lab Groupings (inside the Members tab):
 * Officers with MEMBERS_MANAGE create, edit, lock, and delete groupings (with per-group caps).
 * Students can self-join/switch/leave groups and add/remove guest teammates (G2 / Irregulars)
 * in their own group while self-join is open and the grouping is unlocked.
 */
import { collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import {
  GROUPING_MAX_GROUPS,
  GROUPING_NOTE_MAX,
  GROUPING_TITLE_MAX,
  GROUP_NAME_MAX,
  GUEST_NAME_MAX,
  GUEST_TAG_MAX,
  addGuestToGroup,
  autoAssignMembers,
  buildInitialGroups,
  moveMemberToGroup,
  newGrouping,
  removeGuestFromGroup,
  removeMemberFromGroups,
  type GroupSlot,
  type Grouping,
} from '../domain/groupingLogic';
import { newId, nowMillis } from './dataEnv';
import { UserError } from './errors';
import { commitLogged } from './history';
import { fromDoc, useQueryList } from './live';
import { explainRefusal, withoutId } from './paths';

export {
  GROUPING_MAX_GROUPS,
  GROUPING_NOTE_MAX,
  GROUPING_TITLE_MAX,
  GROUP_NAME_MAX,
  GUEST_NAME_MAX,
  GUEST_TAG_MAX,
};
export type { GroupSlot, Grouping };

export const groupingsCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'groupings');
export const groupingRef = (db: Firestore, classId: string, groupingId: string) =>
  doc(groupingsCol(db, classId), groupingId);

export interface NewGroupingInput {
  title: string;
  courseId: string;
  note: string;
  groupCount: number;
  defaultMaxSize: number;
  customSizes?: number[];
  selfJoin: boolean;
}

/** Creates a new grouping (MEMBERS_MANAGE) and logs it in History. */
export async function createGrouping(
  db: Firestore,
  actorUid: string,
  classId: string,
  input: NewGroupingInput,
): Promise<string> {
  const title = input.title.trim().slice(0, GROUPING_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Give this grouping a title first.');
  const note = input.note.trim().slice(0, GROUPING_NOTE_MAX);
  const groups = buildInitialGroups(
    input.groupCount,
    input.defaultMaxSize,
    () => newId().slice(0, 10),
    input.customSizes,
  );
  const now = nowMillis();
  const id = newId();
  const grouping = newGrouping({
    title,
    courseId: input.courseId,
    note,
    selfJoin: input.selfJoin,
    locked: false,
    groups,
    createdByUid: actorUid,
    createdAtMillis: now,
    updatedAtMillis: now,
  });
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'GROUPING_CREATED', text: `Created the grouping "${title}" (${groups.length} groups)` },
      (b) => b.set(groupingRef(db, classId, id), withoutId(grouping)),
    ),
  );
  return id;
}

/** Updates grouping metadata (title, course, note, selfJoin) (MEMBERS_MANAGE). */
export async function updateGroupingMeta(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
  patch: { title: string; courseId: string; note: string; selfJoin: boolean },
): Promise<void> {
  const title = patch.title.trim().slice(0, GROUPING_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Give this grouping a title first.');
  const note = patch.note.trim().slice(0, GROUPING_NOTE_MAX);
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'GROUPING_UPDATED', text: `Updated the grouping "${title}"` },
      (b) =>
        b.update(groupingRef(db, classId, grouping.id), {
          title,
          courseId: patch.courseId,
          note,
          selfJoin: patch.selfJoin,
          updatedAtMillis: nowMillis(),
        }),
    ),
  );
}

/** Locks or unlocks a grouping (MEMBERS_MANAGE). */
export async function setGroupingLocked(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
  locked: boolean,
): Promise<void> {
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      {
        actorUid,
        kind: 'GROUPING_UPDATED',
        text: `${locked ? 'Locked' : 'Unlocked'} the grouping "${grouping.title}"`,
      },
      (b) => b.update(groupingRef(db, classId, grouping.id), { locked, updatedAtMillis: nowMillis() }),
    ),
  );
}

/** Deletes a grouping (MEMBERS_MANAGE) and logs it in History. */
export async function deleteGrouping(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
): Promise<void> {
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'GROUPING_DELETED', text: `Deleted the grouping "${grouping.title}"` },
      (b) => b.delete(groupingRef(db, classId, grouping.id)),
    ),
  );
}

/** Runs an atomic update on `groups` inside a Firestore transaction so concurrent joins never collide. */
async function mutateGroups(
  db: Firestore,
  classId: string,
  groupingId: string,
  mutate: (current: Grouping) => GroupSlot[],
): Promise<void> {
  await explainRefusal(db, classId, () =>
    runTransaction(db, async (tx) => {
      const ref = groupingRef(db, classId, groupingId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new UserError('CLASS_GONE', 'This grouping was deleted.');
      const current = fromDoc(newGrouping({}), snap);
      let nextGroups: GroupSlot[];
      try {
        nextGroups = mutate(current);
      } catch (e) {
        if (e instanceof UserError) throw e;
        throw new UserError('NAME_MISSING', e instanceof Error ? e.message : 'Could not update group.');
      }
      tx.update(ref, { groups: nextGroups, updatedAtMillis: nowMillis() });
    }),
  );
}

/** Joins or switches a student into `targetGroupId` (self-join or officer assign). */
export async function joinGroup(
  db: Firestore,
  classId: string,
  groupingId: string,
  targetUid: string,
  targetGroupId: string,
  asOfficer = false,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, (g) => {
    if (!asOfficer && (g.locked || !g.selfJoin)) {
      throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
    }
    return moveMemberToGroup(g.groups, targetUid, targetGroupId, asOfficer);
  });
}

/** Removes a student from their group (self-leave or officer remove). */
export async function leaveGroup(
  db: Firestore,
  classId: string,
  groupingId: string,
  targetUid: string,
  asOfficer = false,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, (g) => {
    if (!asOfficer && (g.locked || !g.selfJoin)) {
      throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
    }
    return removeMemberFromGroups(g.groups, targetUid);
  });
}

/** Adds a guest teammate (e.g. G2 or Irregular) to a group. */
export async function addGuestTeammate(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  actorUid: string,
  name: string,
  tag: string,
  asOfficer = false,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, (g) => {
    if (!asOfficer) {
      if (g.locked || !g.selfJoin) {
        throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
      }
      const slot = g.groups.find((x) => x.id === groupId);
      if (!slot || !slot.memberUids.includes(actorUid)) {
        throw new UserError('NO_PERMISSION', 'Join this group first to add a guest teammate.');
      }
    }
    return addGuestToGroup(
      g.groups,
      groupId,
      { id: newId().slice(0, 10), name, tag, addedByUid: actorUid },
      asOfficer,
    );
  });
}

/** Removes a guest teammate from a group. */
export async function removeGuestTeammate(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  guestId: string,
  actorUid: string,
  asOfficer = false,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, (g) => {
    if (!asOfficer) {
      if (g.locked || !g.selfJoin) {
        throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
      }
      const slot = g.groups.find((x) => x.id === groupId);
      if (!slot || !slot.memberUids.includes(actorUid)) {
        throw new UserError('NO_PERMISSION', 'You can only remove guests from your own group.');
      }
    }
    return removeGuestFromGroup(g.groups, groupId, guestId);
  });
}

/** Adds a new group slot to an existing grouping (MEMBERS_MANAGE). */
export async function addGroupSlot(
  db: Firestore,
  classId: string,
  groupingId: string,
  name: string,
  maxSize: number,
): Promise<void> {
  const cleanName = name.trim().slice(0, GROUP_NAME_MAX);
  if (!cleanName) throw new UserError('NAME_MISSING', 'Give the group a name.');
  await mutateGroups(db, classId, groupingId, (g) => {
    if (g.groups.length >= GROUPING_MAX_GROUPS) {
      throw new UserError('NAME_MISSING', `A grouping can have at most ${GROUPING_MAX_GROUPS} groups.`);
    }
    return [
      ...g.groups,
      { id: newId().slice(0, 10), name: cleanName, maxSize: Math.max(0, Math.trunc(maxSize)), memberUids: [], guests: [] },
    ];
  });
}

/** Updates a group slot's name and per-group capacity (MEMBERS_MANAGE). */
export async function editGroupSlot(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  name: string,
  maxSize: number,
): Promise<void> {
  const cleanName = name.trim().slice(0, GROUP_NAME_MAX);
  if (!cleanName) throw new UserError('NAME_MISSING', 'Give the group a name.');
  await mutateGroups(db, classId, groupingId, (g) =>
    g.groups.map((slot) =>
      slot.id === groupId ? { ...slot, name: cleanName, maxSize: Math.max(0, Math.trunc(maxSize)) } : slot,
    ),
  );
}

/** Deletes a group slot from a grouping (MEMBERS_MANAGE). */
export async function deleteGroupSlot(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, (g) => {
    if (g.groups.length <= 1) throw new UserError('NAME_MISSING', 'A grouping needs at least one group.');
    return g.groups.filter((slot) => slot.id !== groupId);
  });
}

/** Evenly distributes ungrouped students across groups with open slots (MEMBERS_MANAGE). */
export async function autoAssignUngrouped(
  db: Firestore,
  classId: string,
  groupingId: string,
  eligibleUids: string[],
): Promise<number> {
  let count = 0;
  await mutateGroups(db, classId, groupingId, (g) => {
    const res = autoAssignMembers(g.groups, eligibleUids);
    count = res.assigned;
    return res.groups;
  });
  return count;
}

/** All groupings in the class, newest first. */
export function useGroupings(db: Firestore, classId: string, enabled: boolean) {
  const live = useQueryList<Grouping>(
    `v2/groupings/${classId}/${enabled}`,
    enabled ? groupingsCol(db, classId) : null,
    (d) => fromDoc(newGrouping({}), d),
  );
  return {
    ...live,
    data: live.data ? [...live.data].sort((a, b) => b.createdAtMillis - a.createdAtMillis) : live.data,
  };
}

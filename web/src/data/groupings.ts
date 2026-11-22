/*
 * Project & Lab Groupings (inside the Members tab):
 * Supports both single-class groupings (classes/{classId}/groupings/{id}) and
 * cross-class shared groupings (/sharedGroupings/{id}, linked via a short share code).
 */
import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import {
  GROUPING_MAX_GROUPS,
  GROUPING_NOTE_MAX,
  GROUPING_TITLE_MAX,
  GROUP_NAME_MAX,
  GUEST_NAME_MAX,
  GUEST_TAG_MAX,
  SHARED_MAX_CLASSES,
  addGuestToGroup,
  autoAssignMembers,
  buildInitialGroups,
  moveMemberToGroup,
  newGrouping,
  removeGuestFromGroup,
  removeMemberFromGroups,
  type GroupSlot,
  type Grouping,
  type MemberMeta,
  type SharedClassLink,
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
  SHARED_MAX_CLASSES,
};
export type { GroupSlot, Grouping, MemberMeta, SharedClassLink };

export const groupingsCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'groupings');
export const groupingRef = (db: Firestore, classId: string, groupingId: string) =>
  doc(groupingsCol(db, classId), groupingId);

export const sharedGroupingLinksCol = (db: Firestore, classId: string) =>
  collection(db, 'classes', classId, 'sharedGroupingLinks');
export const sharedGroupingLinkRef = (db: Firestore, classId: string, sharedId: string) =>
  doc(sharedGroupingLinksCol(db, classId), sharedId);

export const sharedGroupingRef = (db: Firestore, sharedId: string) => doc(db, 'sharedGroupings', sharedId);
export const groupingInviteRef = (db: Firestore, code: string) => doc(db, 'groupingInvites', code);

function targetRef(db: Firestore, classId: string, groupingId: string, shared?: boolean) {
  return shared ? sharedGroupingRef(db, groupingId) : groupingRef(db, classId, groupingId);
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeShareCode(): string {
  let out = 'GRP-';
  for (let i = 0; i < 4; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

export interface NewGroupingInput {
  title: string;
  courseId: string;
  note: string;
  groupCount: number;
  defaultMaxSize: number;
  customSizes?: number[];
  selfJoin: boolean;
  /** When true, creates a cross-class shared grouping with a share code. */
  shared?: boolean;
  className?: string;
  sectionTag?: string;
}

/** Creates a local or shared cross-class grouping (MEMBERS_MANAGE) and logs it in History. */
export async function createGrouping(
  db: Firestore,
  actorUid: string,
  classId: string,
  input: NewGroupingInput,
): Promise<{ id: string; shareCode?: string }> {
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

  if (input.shared) {
    const shareCode = makeShareCode();
    const hostClassName = (input.className ?? '').trim().slice(0, 100) || 'Host class';
    const tag = (input.sectionTag ?? '').trim().slice(0, GUEST_TAG_MAX) || hostClassName.slice(0, GUEST_TAG_MAX);
    const sharedDoc = {
      title,
      note,
      hostClassId: classId,
      shareCode,
      linkedClassIds: [classId],
      linkedClasses: {
        [classId]: { name: hostClassName, tag, courseId: input.courseId },
      },
      selfJoin: input.selfJoin,
      locked: false,
      groups,
      createdByUid: actorUid,
      createdAtMillis: now,
      updatedAtMillis: now,
    };
    await explainRefusal(db, classId, () =>
      commitLogged(
        db,
        classId,
        { actorUid, kind: 'GROUPING_CREATED', text: `Created the shared grouping "${title}" (${groups.length} groups)` },
        (b) => {
          b.set(sharedGroupingRef(db, id), sharedDoc);
          b.set(groupingInviteRef(db, shareCode), {
            sharedId: id,
            title,
            hostClassId: classId,
            hostClassName,
          });
          b.set(sharedGroupingLinkRef(db, classId, id), { sharedId: id, linkedAtMillis: now });
        },
      ),
    );
    return { id, shareCode };
  }

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
  return { id };
}

/** Links an existing shared grouping to this class using its share code (MEMBERS_MANAGE). */
export async function linkSharedGrouping(
  db: Firestore,
  actorUid: string,
  classId: string,
  className: string,
  rawCode: string,
  sectionTag: string,
  courseId: string,
): Promise<string> {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw new UserError('NAME_MISSING', 'Enter the grouping share code.');
  const invSnap = await getDoc(groupingInviteRef(db, code));
  if (!invSnap.exists()) throw new UserError('NAME_MISSING', `No shared grouping found for code "${code}".`);
  const { sharedId, title } = invSnap.data() as { sharedId: string; title: string };
  const cleanName = className.trim().slice(0, 100) || 'Partner class';
  const tag = sectionTag.trim().slice(0, GUEST_TAG_MAX) || cleanName.slice(0, GUEST_TAG_MAX);
  const now = nowMillis();

  await explainRefusal(db, classId, () =>
    runTransaction(db, async (tx) => {
      const ref = sharedGroupingRef(db, sharedId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new UserError('CLASS_GONE', 'That shared grouping was deleted.');
      const data = snap.data() as {
        linkedClassIds?: string[];
        linkedClasses?: Record<string, SharedClassLink>;
      };
      const ids = Array.isArray(data.linkedClassIds) ? [...data.linkedClassIds] : [];
      if (ids.includes(classId)) {
        // Already linked — ensure local pointer exists
        tx.set(sharedGroupingLinkRef(db, classId, sharedId), { sharedId, linkedAtMillis: now });
        return;
      }
      if (ids.length >= SHARED_MAX_CLASSES) {
        throw new UserError('NAME_MISSING', `A shared grouping can link at most ${SHARED_MAX_CLASSES} classes.`);
      }
      const nextIds = [...ids, classId];
      const nextClasses = {
        ...(data.linkedClasses ?? {}),
        [classId]: { name: cleanName, tag, courseId },
      };
      tx.update(ref, { linkedClassIds: nextIds, linkedClasses: nextClasses, updatedAtMillis: now });
      tx.set(sharedGroupingLinkRef(db, classId, sharedId), { sharedId, linkedAtMillis: now });
    }),
  );

  await commitLogged(
    db,
    classId,
    { actorUid, kind: 'GROUPING_UPDATED', text: `Linked shared grouping "${title}" (${code})` },
    () => undefined,
  ).catch(() => undefined);

  return title;
}

/** Unlinks a partner class from a shared grouping (host officer or partner officer). */
export async function unlinkSharedGrouping(
  db: Firestore,
  actorUid: string,
  actingClassId: string,
  grouping: Grouping,
  targetClassId: string,
): Promise<void> {
  if (!grouping.shared) return;
  if (targetClassId === grouping.hostClassId) {
    throw new UserError('NO_PERMISSION', 'The host class cannot unlink itself. Delete the grouping instead.');
  }
  const now = nowMillis();
  await explainRefusal(db, actingClassId, () =>
    runTransaction(db, async (tx) => {
      const ref = sharedGroupingRef(db, grouping.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() as {
        linkedClassIds?: string[];
        linkedClasses?: Record<string, SharedClassLink>;
      };
      const nextIds = (data.linkedClassIds ?? []).filter((id) => id !== targetClassId);
      const nextClasses = { ...(data.linkedClasses ?? {}) };
      delete nextClasses[targetClassId];
      tx.update(ref, { linkedClassIds: nextIds, linkedClasses: nextClasses, updatedAtMillis: now });
      if (actingClassId === targetClassId) {
        tx.delete(sharedGroupingLinkRef(db, targetClassId, grouping.id));
      }
    }),
  );
  await commitLogged(
    db,
    actingClassId,
    { actorUid, kind: 'GROUPING_UPDATED', text: `Unlinked a class from "${grouping.title}"` },
    () => undefined,
  ).catch(() => undefined);
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
  const now = nowMillis();

  if (grouping.shared) {
    const curLink = grouping.linkedClasses?.[classId];
    const nextLinkedClasses = curLink
      ? { ...(grouping.linkedClasses ?? {}), [classId]: { ...curLink, courseId: patch.courseId } }
      : grouping.linkedClasses ?? {};
    await explainRefusal(db, classId, () =>
      commitLogged(
        db,
        classId,
        { actorUid, kind: 'GROUPING_UPDATED', text: `Updated the shared grouping "${title}"` },
        (b) =>
          b.update(sharedGroupingRef(db, grouping.id), {
            title,
            note,
            selfJoin: patch.selfJoin,
            linkedClasses: nextLinkedClasses,
            updatedAtMillis: now,
          }),
      ),
    );
    return;
  }

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
          updatedAtMillis: now,
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
      (b) => b.update(targetRef(db, classId, grouping.id, grouping.shared), { locked, updatedAtMillis: nowMillis() }),
    ),
  );
}

/** Deletes a grouping (host officer for shared groupings, or class officer for local groupings). */
export async function deleteGrouping(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
): Promise<void> {
  if (grouping.shared) {
    await explainRefusal(db, classId, () =>
      commitLogged(
        db,
        classId,
        { actorUid, kind: 'GROUPING_DELETED', text: `Deleted the shared grouping "${grouping.title}"` },
        (b) => {
          b.delete(sharedGroupingRef(db, grouping.id));
          if (grouping.shareCode) b.delete(groupingInviteRef(db, grouping.shareCode));
          b.delete(sharedGroupingLinkRef(db, classId, grouping.id));
        },
      ),
    );
    return;
  }
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
  shared: boolean | undefined,
  mutate: (current: Grouping) => GroupSlot[],
): Promise<void> {
  await explainRefusal(db, classId, () =>
    runTransaction(db, async (tx) => {
      const ref = targetRef(db, classId, groupingId, shared);
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
  shared?: boolean,
  meta?: MemberMeta,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (!asOfficer && (g.locked || !g.selfJoin)) {
      throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
    }
    return moveMemberToGroup(g.groups, targetUid, targetGroupId, asOfficer, meta);
  });
}

/** Removes a student from their group (self-leave or officer remove). */
export async function leaveGroup(
  db: Firestore,
  classId: string,
  groupingId: string,
  targetUid: string,
  asOfficer = false,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (!asOfficer && (g.locked || !g.selfJoin)) {
      throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
    }
    return removeMemberFromGroups(g.groups, targetUid);
  });
}

/** Adds a guest teammate (e.g. Irregular) to a group. */
export async function addGuestTeammate(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  actorUid: string,
  name: string,
  tag: string,
  asOfficer = false,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
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
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
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
  shared?: boolean,
): Promise<void> {
  const cleanName = name.trim().slice(0, GROUP_NAME_MAX);
  if (!cleanName) throw new UserError('NAME_MISSING', 'Give the group a name.');
  await mutateGroups(db, classId, groupingId, shared, (g) => {
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
  shared?: boolean,
): Promise<void> {
  const cleanName = name.trim().slice(0, GROUP_NAME_MAX);
  if (!cleanName) throw new UserError('NAME_MISSING', 'Give the group a name.');
  await mutateGroups(db, classId, groupingId, shared, (g) =>
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
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
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
  shared?: boolean,
  metaFor?: (uid: string) => MemberMeta | undefined,
): Promise<number> {
  let count = 0;
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    const res = autoAssignMembers(g.groups, eligibleUids, metaFor);
    count = res.assigned;
    return res.groups;
  });
  return count;
}

/** Local (single-class) groupings, newest first. */
export function useLocalGroupings(db: Firestore, classId: string, enabled: boolean) {
  return useQueryList<Grouping>(
    `v2/groupings/${classId}/${enabled}`,
    enabled ? groupingsCol(db, classId) : null,
    (d) => fromDoc(newGrouping({}), d),
  );
}

/** Shared cross-class groupings linked to this class, live via per-doc listeners. */
export function useSharedGroupings(db: Firestore, classId: string, enabled: boolean): Grouping[] | undefined {
  const links = useQueryList<{ id: string; sharedId: string }>(
    `v2/sharedGroupingLinks/${classId}/${enabled}`,
    enabled ? sharedGroupingLinksCol(db, classId) : null,
    (d) => ({ id: d.id, sharedId: String(d.data()?.sharedId ?? d.id) }),
  );
  const linkKey = (links.data ?? []).map((l) => l.sharedId).sort().join(',');
  const [docs, setDocs] = useState<Map<string, Grouping | null>>(() => new Map());

  useEffect(() => {
    if (!enabled || !links.data) return;
    const ids = links.data.map((l) => l.sharedId);
    if (ids.length === 0) {
      setDocs(new Map());
      return;
    }
    const unsubs = ids.map((sharedId) =>
      onSnapshot(
        sharedGroupingRef(db, sharedId),
        (snap) => {
          setDocs((prev) => {
            const next = new Map(prev);
            if (!snap.exists()) {
              next.set(sharedId, null);
            } else {
              const raw = fromDoc(newGrouping({}), snap);
              const myLink = raw.linkedClasses?.[classId];
              next.set(sharedId, {
                ...raw,
                shared: true,
                courseId: myLink?.courseId ?? '',
              });
            }
            return next;
          });
        },
        () => {
          // Unlinked or deleted shared grouping: hide gracefully.
          setDocs((prev) => {
            const next = new Map(prev);
            next.set(sharedId, null);
            return next;
          });
        },
      ),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [db, classId, enabled, linkKey]);

  if (!enabled || links.data === undefined) return undefined;
  const result: Grouping[] = [];
  for (const l of links.data) {
    const g = docs.get(l.sharedId);
    if (g) result.push(g);
  }
  return result;
}

/** Combined local + shared groupings in this class, newest first. */
export function useGroupings(db: Firestore, classId: string, enabled: boolean): { data: Grouping[] | undefined } {
  const local = useLocalGroupings(db, classId, enabled);
  const shared = useSharedGroupings(db, classId, enabled);
  if (local.data === undefined || shared === undefined) return { data: undefined };
  const merged = [...local.data, ...shared].sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  return { data: merged };
}

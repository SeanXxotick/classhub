/*
 * Project & Lab Groupings (inside the Members tab):
 * Supports both single-class groupings (classes/{classId}/groupings/{id}) and
 * cross-class shared groupings (/sharedGroupings/{id}, linked via a short share code).
 */
import { useEffect, useState } from 'react';
import {
  FieldPath,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type WriteBatch,
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
  approveGroupJoinRequest,
  autoAssignMembers,
  buildInitialGroups,
  changedEntries,
  decodeGroups,
  effectiveLeaderUid,
  encodeGroups,
  isLegacyGrouping,
  storedMaps,
  moveMemberToGroup,
  newGrouping,
  passGroupLeadership,
  removeGroupJoinRequest,
  removeGuestFromGroup,
  removeMemberFromGroups,
  requestToJoinGroup,
  type GroupJoinRequest,
  type GroupSlot,
  type Grouping,
  type MemberMeta,
  type SharedClassLink,
  type SharedRosterEntry,
} from '../domain/groupingLogic';
import { newId, nowMillis } from './dataEnv';
import { UserError } from './errors';
import { commitLogged } from './history';
import { fromDoc, useQueryList } from './live';
import { partnerRef, savePartnerClass } from './partners';
import { explainRefusal } from './paths';

export {
  GROUPING_MAX_GROUPS,
  GROUPING_NOTE_MAX,
  GROUPING_TITLE_MAX,
  GROUP_NAME_MAX,
  GUEST_NAME_MAX,
  GUEST_TAG_MAX,
  SHARED_MAX_CLASSES,
};
export type { GroupJoinRequest, GroupSlot, Grouping, MemberMeta, SharedClassLink, SharedRosterEntry };

export const groupingsCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'groupings');
export const groupingRef = (db: Firestore, classId: string, groupingId: string) =>
  doc(groupingsCol(db, classId), groupingId);

export const sharedGroupingLinksCol = (db: Firestore, classId: string) =>
  collection(db, 'classes', classId, 'sharedGroupingLinks');
export const sharedGroupingLinkRef = (db: Firestore, classId: string, sharedId: string) =>
  doc(sharedGroupingLinksCol(db, classId), sharedId);

export const sharedGroupingRef = (db: Firestore, sharedId: string) => doc(db, 'sharedGroupings', sharedId);
export const groupingInviteRef = (db: Firestore, code: string) => doc(db, 'groupingInvites', code);

/** A grouping as the screens use it, from its stored document. */
function groupingFrom(snap: DocumentSnapshot<DocumentData>): Grouping {
  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  const g = fromDoc(newGrouping({}), snap) as Grouping & Record<string, unknown>;
  for (const k of ['seats', 'meta', 'leaders', 'requests', 'guests', 'act', 'linkCode']) delete g[k];
  return { ...g, groups: decodeGroups(raw) };
}

/** The fields that hold a new grouping's groups. */
function storedGroups(groups: GroupSlot[], now: number) {
  return { ...encodeGroups(groups, null, now), act: '' };
}

function targetRef(db: Firestore, classId: string, groupingId: string, shared?: boolean) {
  return shared ? sharedGroupingRef(db, groupingId) : groupingRef(db, classId, groupingId);
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_TRIES = 5;
function makeShareCode(): string {
  let out = 'GRP-';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) out += CODE_CHARS[b % CODE_CHARS.length];
  return out;
}

async function unusedShareCode(db: Firestore): Promise<string> {
  for (let i = 0; i < MAX_CODE_TRIES; i++) {
    const code = makeShareCode();
    if (!(await getDoc(groupingInviteRef(db, code))).exists()) return code;
  }
  throw new UserError('INVITE_CODE_UNAVAILABLE', 'Could not generate a share code. Try again.');
}

export interface NewGroupingInput {
  title: string;
  courseId: string;
  note: string;
  groupCount: number;
  defaultMaxSize: number;
  customSizes?: number[];
  selfJoin: boolean;
  hasLeader?: boolean;
  /** When true, creates a cross-class shared grouping with a share code. */
  shared?: boolean;
  className?: string;
  sectionTag?: string;
  accentColor?: string;
  roster?: SharedRosterEntry[];
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
    const shareCode = await unusedShareCode(db);
    const hostClassName = (input.className ?? '').trim().slice(0, 100) || 'Host class';
    const tag = (input.sectionTag ?? '').trim().slice(0, GUEST_TAG_MAX) || hostClassName.slice(0, GUEST_TAG_MAX);
    const sharedDoc = {
      title,
      note,
      hostClassId: classId,
      shareCode,
      linkedClassIds: [classId],
      linkedClasses: {
        [classId]: {
          name: hostClassName,
          tag,
          courseId: input.courseId,
          ...(input.accentColor ? { accentColor: input.accentColor } : {}),
          ...(input.roster ? { roster: input.roster } : {}),
        },
      },
      selfJoin: input.selfJoin,
      locked: false,
      hasLeader: !!input.hasLeader,
      ...storedGroups(groups, now),
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

  const grouping = {
    title,
    courseId: input.courseId,
    note,
    selfJoin: input.selfJoin,
    locked: false,
    hasLeader: !!input.hasLeader,
    ...storedGroups(groups, now),
    createdByUid: actorUid,
    createdAtMillis: now,
    updatedAtMillis: now,
  };
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'GROUPING_CREATED', text: `Created the grouping "${title}" (${groups.length} groups)` },
      (b) => b.set(groupingRef(db, classId, id), grouping),
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
  accentColor?: string,
  roster?: SharedRosterEntry[],
): Promise<string> {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw new UserError('NAME_MISSING', 'Enter the grouping share code.');
  const invSnap = await getDoc(groupingInviteRef(db, code));
  if (!invSnap.exists()) throw new UserError('NAME_MISSING', `No shared grouping found for code "${code}".`);
  const { sharedId, title, hostClassId, hostClassName } = invSnap.data() as {
    sharedId: string;
    title: string;
    hostClassId: string;
    hostClassName: string;
  };
  const cleanName = className.trim().slice(0, 100) || 'Partner class';
  const tag = sectionTag.trim().slice(0, GUEST_TAG_MAX) || cleanName.slice(0, GUEST_TAG_MAX);
  const now = nowMillis();

  // This class cannot read the grouping until it is linked, so the write names the code it used and the
  // rules check that the code belongs to this grouping.
  const existingLink = await getDoc(sharedGroupingLinkRef(db, classId, sharedId)).catch(() => null);
  if (existingLink?.exists()) {
    const cur = await getDoc(sharedGroupingRef(db, sharedId)).catch(() => null);
    const linkedIds = (cur?.data()?.linkedClassIds as string[] | undefined) ?? [];
    if (cur?.exists() && linkedIds.includes(classId)) {
      throw new UserError('NAME_MISSING', `${title} is already linked to this class.`);
    }
  }
  const batch = writeBatch(db);
  batch.update(
    sharedGroupingRef(db, sharedId),
    new FieldPath('linkedClassIds'),
    arrayUnion(classId),
    new FieldPath('linkedClasses', classId),
    { name: cleanName, tag, courseId, ...(accentColor ? { accentColor } : {}), ...(roster ? { roster } : {}) },
    new FieldPath('linkCode'),
    code,
    new FieldPath('updatedAtMillis'),
    now,
  );
  if (!existingLink?.exists()) {
    batch.set(sharedGroupingLinkRef(db, classId, sharedId), { sharedId, linkedAtMillis: now });
  }
  try {
    await explainRefusal(db, classId, () => batch.commit());
  } catch (e) {
    if (e instanceof UserError) throw e;
    // The grouping was deleted, or it already links the most classes it can.
    throw new UserError('NO_PERMISSION', `That grouping could not be linked. It may have been deleted, or it already links ${SHARED_MAX_CLASSES} classes.`);
  }

  // Register the host class as a partner of this class (the host registers this class on its own side
  // when a host officer views the grouping, so knowing a share code never grants unsolicited trust).
  if (hostClassId && hostClassId !== classId) {
    const sharedSnap = await getDoc(sharedGroupingRef(db, sharedId)).catch(() => null);
    const hostLink = (sharedSnap?.data()?.linkedClasses as Record<string, SharedClassLink> | undefined)?.[hostClassId];
    await savePartnerClass(db, classId, {
      partnerClassId: hostClassId,
      name: hostLink?.name || hostClassName || 'Host class',
      tag: hostLink?.tag || (hostClassName || 'Host').slice(0, GUEST_TAG_MAX),
      accentColor: hostLink?.accentColor ?? '',
    }).catch(() => undefined);
  }

  await commitLogged(
    db,
    classId,
    { actorUid, kind: 'GROUPING_UPDATED', text: `Linked shared grouping "${title}" (${code})` },
    () => undefined,
  ).catch(() => undefined);

  return title;
}

/**
 * Ending a shared grouping: this class stops trusting the other classes it linked, so they can no longer
 * send it polls or notifications. Any shared grouping that still links two classes registers them again
 * when an officer opens it.
 */
function forgetPartners(b: WriteBatch, db: Firestore, classId: string, grouping: Grouping): void {
  for (const id of grouping.linkedClassIds ?? []) {
    if (id && id !== classId) b.delete(partnerRef(db, classId, id));
  }
}

/**
 * Unlinks a partner class from a shared grouping (host officer or partner officer).
 * Seated members from the unlinked class are converted into tagged guests so existing teams stay intact,
 * and when the host unlinks a class, the share code rotates so the old code cannot re-link.
 */
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
  const isHostActing = actingClassId === grouping.hostClassId;
  const nextShareCode = isHostActing ? await unusedShareCode(db) : '';
  await explainRefusal(db, actingClassId, () =>
    runTransaction(db, async (tx) => {
      const ref = sharedGroupingRef(db, grouping.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const cur = groupingFrom(snap);
      const unlinkedTag = cur.linkedClasses?.[targetClassId]?.tag ?? '';
      const nextIds = (cur.linkedClassIds ?? []).filter((id) => id !== targetClassId);
      const nextClasses = { ...(cur.linkedClasses ?? {}) };
      delete nextClasses[targetClassId];

      // Convert seated members from the unlinked class into tagged guests and drop its pending requests.
      const nextGroups: GroupSlot[] = cur.groups.map((slot) => {
        const keptUids: string[] = [];
        const keptMeta: Record<string, MemberMeta> = {};
        const nextGuests = [...slot.guests];
        for (const uid of slot.memberUids) {
          const meta = slot.memberMeta?.[uid];
          if (meta?.classId === targetClassId) {
            nextGuests.push({
              id: newId().slice(0, 10),
              name: (meta.name || 'Former member').slice(0, GUEST_NAME_MAX),
              tag: (meta.tag || unlinkedTag).slice(0, GUEST_TAG_MAX),
              addedByUid: actorUid,
            });
          } else {
            keptUids.push(uid);
            if (meta) keptMeta[uid] = meta;
          }
        }
        const nextLeader = slot.leaderUid && keptUids.includes(slot.leaderUid) ? slot.leaderUid : keptUids[0] ?? '';
        const nextReqs = (slot.joinRequests ?? []).filter((r) => r.classId !== targetClassId);
        return {
          ...slot,
          memberUids: keptUids,
          memberMeta: keptMeta,
          ...(nextLeader ? { leaderUid: nextLeader } : { leaderUid: '' }),
          joinRequests: nextReqs,
          guests: nextGuests,
        };
      });

      if (isHostActing && nextShareCode) {
        if (cur.shareCode) tx.delete(groupingInviteRef(db, cur.shareCode));
        const hostName = cur.linkedClasses?.[actingClassId]?.name || 'Host class';
        tx.set(groupingInviteRef(db, nextShareCode), {
          sharedId: grouping.id,
          title: cur.title,
          hostClassId: actingClassId,
          hostClassName: hostName,
        });
      }
      tx.update(ref, {
        linkedClassIds: nextIds,
        linkedClasses: nextClasses,
        ...storedGroups(nextGroups, now),
        ...(isHostActing && nextShareCode ? { shareCode: nextShareCode } : {}),
        updatedAtMillis: now,
      });
      if (actingClassId === targetClassId) {
        tx.delete(sharedGroupingLinkRef(db, targetClassId, grouping.id));
      }
      // The acting class stops trusting the class it unlinked (or, when it leaves, every class it was linked
      // with here), so they can no longer send it polls or notifications. A shared grouping that still links
      // two classes registers them as partners again when an officer opens it. Same transaction as the
      // unlink, so the screen never sees the partner gone while the grouping still lists it.
      const formerPartners = actingClassId === targetClassId ? nextIds : [targetClassId];
      for (const id of formerPartners) {
        if (id && id !== actingClassId) tx.delete(partnerRef(db, actingClassId, id));
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

/** Converts a local grouping into a shared cross-class grouping, preserving all groups and members. */
export async function enableGroupingSharing(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
  patch: {
    title: string;
    courseId: string;
    note: string;
    selfJoin: boolean;
    hasLeader: boolean;
    className: string;
    sectionTag: string;
    accentColor?: string;
    roster: SharedRosterEntry[];
    memberNameOf: (uid: string) => string;
  },
): Promise<string> {
  const title = patch.title.trim().slice(0, GROUPING_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Give this grouping a title first.');
  const note = patch.note.trim().slice(0, GROUPING_NOTE_MAX);
  const hostClassName = patch.className.trim().slice(0, 100) || 'Host class';
  const tag = patch.sectionTag.trim().slice(0, GUEST_TAG_MAX) || hostClassName.slice(0, GUEST_TAG_MAX);
  const shareCode = await unusedShareCode(db);
  const now = nowMillis();
  const newSharedId = newId();

  const groupsWithMeta: GroupSlot[] = grouping.groups.map((slot) => {
    const memberMeta: Record<string, MemberMeta> = { ...(slot.memberMeta ?? {}) };
    for (const uid of slot.memberUids) {
      if (!memberMeta[uid]) {
        memberMeta[uid] = { name: patch.memberNameOf(uid), classId, tag };
      }
    }
    return { ...slot, memberMeta };
  });

  const sharedDoc = {
    title,
    note,
    hostClassId: classId,
    shareCode,
    linkedClassIds: [classId],
    linkedClasses: {
      [classId]: {
        name: hostClassName,
        tag,
        courseId: patch.courseId,
        ...(patch.accentColor ? { accentColor: patch.accentColor } : {}),
        roster: patch.roster,
      },
    },
    selfJoin: patch.selfJoin,
    locked: grouping.locked,
    hasLeader: patch.hasLeader,
    ...storedGroups(groupsWithMeta, now),
    createdByUid: actorUid,
    createdAtMillis: now,
    updatedAtMillis: now,
  };

  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'GROUPING_UPDATED', text: `Enabled sharing for "${title}" (${shareCode})` },
      (b) => {
        b.set(sharedGroupingRef(db, newSharedId), sharedDoc);
        b.set(groupingInviteRef(db, shareCode), {
          sharedId: newSharedId,
          title,
          hostClassId: classId,
          hostClassName,
        });
        b.set(sharedGroupingLinkRef(db, classId, newSharedId), { sharedId: newSharedId, linkedAtMillis: now });
        b.delete(groupingRef(db, classId, grouping.id));
      },
    ),
  );
  return shareCode;
}

/** Converts a host-owned shared grouping back into a single-class grouping, keeping partner members as tagged guests. */
export async function disableGroupingSharing(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
  patch: {
    title: string;
    courseId: string;
    note: string;
    selfJoin: boolean;
    hasLeader: boolean;
    localMemberIds: Set<string>;
  },
): Promise<void> {
  if (!grouping.shared || grouping.hostClassId !== classId) {
    throw new UserError('NO_PERMISSION', 'Only the host class can turn off sharing.');
  }
  const title = patch.title.trim().slice(0, GROUPING_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Give this grouping a title first.');
  const note = patch.note.trim().slice(0, GROUPING_NOTE_MAX);
  const now = nowMillis();
  const newLocalId = newId();

  const localGroups: GroupSlot[] = grouping.groups.map((slot) => {
    const keptUids: string[] = [];
    const extraGuests = [...slot.guests];
    for (const uid of slot.memberUids) {
      if (patch.localMemberIds.has(uid)) {
        keptUids.push(uid);
      } else {
        const meta = slot.memberMeta?.[uid];
        if (meta?.name) {
          extraGuests.push({
            id: newId().slice(0, 10),
            name: meta.name.slice(0, GUEST_NAME_MAX),
            tag: (meta.tag ?? '').slice(0, GUEST_TAG_MAX),
            addedByUid: actorUid,
          });
        }
      }
    }
    const nextLeader = slot.leaderUid && keptUids.includes(slot.leaderUid) ? slot.leaderUid : keptUids[0] ?? '';
    return {
      id: slot.id,
      name: slot.name,
      maxSize: slot.maxSize,
      memberUids: keptUids,
      ...(nextLeader ? { leaderUid: nextLeader } : {}),
      guests: extraGuests,
    };
  });

  const localDoc = {
    title,
    courseId: patch.courseId,
    note,
    selfJoin: patch.selfJoin,
    locked: grouping.locked,
    hasLeader: patch.hasLeader,
    ...storedGroups(localGroups, now),
    createdByUid: actorUid,
    createdAtMillis: now,
    updatedAtMillis: now,
  };

  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'GROUPING_UPDATED', text: `Turned off sharing for "${title}"` },
      (b) => {
        b.set(groupingRef(db, classId, newLocalId), localDoc);
        b.delete(sharedGroupingRef(db, grouping.id));
        if (grouping.shareCode) b.delete(groupingInviteRef(db, grouping.shareCode));
        b.delete(sharedGroupingLinkRef(db, classId, grouping.id));
        forgetPartners(b, db, classId, grouping);
      },
    ),
  );
}

/** Updates grouping metadata (title, course, note, selfJoin) (MEMBERS_MANAGE). */
export async function updateGroupingMeta(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
  patch: { title: string; courseId: string; note: string; selfJoin: boolean; hasLeader: boolean; roster?: SharedRosterEntry[] },
): Promise<void> {
  const title = patch.title.trim().slice(0, GROUPING_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Give this grouping a title first.');
  const note = patch.note.trim().slice(0, GROUPING_NOTE_MAX);
  const now = nowMillis();

  if (grouping.shared) {
    const curLink = grouping.linkedClasses?.[classId];
    // Only this class's own entry: writing the whole map from this screen's copy would drop a class that
    // linked since it loaded.
    const ownLink: unknown[] = curLink
      ? [new FieldPath('linkedClasses', classId), { ...curLink, courseId: patch.courseId, ...(patch.roster ? { roster: patch.roster } : {}) }]
      : [];
    await explainRefusal(db, classId, () =>
      commitLogged(
        db,
        classId,
        { actorUid, kind: 'GROUPING_UPDATED', text: `Updated the shared grouping "${title}"` },
        (b) =>
          b.update(
            sharedGroupingRef(db, grouping.id),
            new FieldPath('title'),
            title,
            new FieldPath('note'),
            note,
            new FieldPath('selfJoin'),
            patch.selfJoin,
            new FieldPath('hasLeader'),
            patch.hasLeader,
            new FieldPath('updatedAtMillis'),
            now,
            ...ownLink,
          ),
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
          hasLeader: patch.hasLeader,
          updatedAtMillis: now,
        }),
    ),
  );
}

/** Toggles group leaders on or off anytime (MEMBERS_MANAGE). */
export async function setGroupingHasLeader(
  db: Firestore,
  actorUid: string,
  classId: string,
  grouping: Grouping,
  hasLeader: boolean,
): Promise<void> {
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      {
        actorUid,
        kind: 'GROUPING_UPDATED',
        text: `${hasLeader ? 'Turned on' : 'Turned off'} group leaders for "${grouping.title}"`,
      },
      (b) => b.update(targetRef(db, classId, grouping.id, grouping.shared), { hasLeader, updatedAtMillis: nowMillis() }),
    ),
  );
}

/** Passes leadership of a group to another member (current leader while unlocked, or officer anytime). */
export async function setGroupLeader(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  actorUid: string,
  newLeaderUid: string,
  asOfficer = false,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (!asOfficer) {
      if (g.locked) throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
      if (!g.hasLeader) throw new UserError('NO_PERMISSION', 'Group leaders are turned off.');
      const slot = g.groups.find((x) => x.id === groupId);
      if (!slot || effectiveLeaderUid(slot, true) !== actorUid) {
        throw new UserError('NO_PERMISSION', 'Only the current leader can pass leadership.');
      }
    }
    return passGroupLeadership(g.groups, groupId, newLeaderUid);
  });
}

/** Refreshes this class's eligible roster and default accent color on a shared grouping. */
export async function syncSharedRoster(
  db: Firestore,
  classId: string,
  grouping: Grouping,
  roster: SharedRosterEntry[],
  accentColor?: string,
): Promise<void> {
  if (!grouping.shared) return;
  const curLink = grouping.linkedClasses?.[classId];
  if (!curLink) return;
  // Only this class's own entry, so a class that linked since this screen loaded keeps its own.
  const { accentColor: _oldAccent, ...restLink } = curLink;
  const nextLink = { ...restLink, roster, ...(accentColor ? { accentColor } : {}) };
  const batch = writeBatch(db);
  batch.update(
    sharedGroupingRef(db, grouping.id),
    new FieldPath('linkedClasses', classId),
    nextLink,
    new FieldPath('updatedAtMillis'),
    nowMillis(),
  );
  await batch.commit();
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
          forgetPartners(b, db, classId, grouping);
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
  /** The entry this change is about: a guest id, or the student a leader decides on. */
  act = '',
): Promise<void> {
  await explainRefusal(db, classId, () =>
    runTransaction(db, async (tx) => {
      const ref = targetRef(db, classId, groupingId, shared);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new UserError('CLASS_GONE', 'This grouping was deleted.');
      const raw = (snap.data() ?? {}) as Record<string, unknown>;
      const current = groupingFrom(snap);
      let nextGroups: GroupSlot[];
      try {
        nextGroups = mutate(current);
      } catch (e) {
        if (e instanceof UserError) throw e;
        throw new UserError('NAME_MISSING', e instanceof Error ? e.message : 'Could not update group.');
      }
      const now = nowMillis();
      const before = storedMaps(raw);
      const after = encodeGroups(nextGroups, isLegacyGrouping(raw) ? null : before, now);
      if (isLegacyGrouping(raw)) {
        // Written before the maps: an officer's change stores it in the new form.
        tx.update(ref, { ...after, act, updatedAtMillis: now });
        return;
      }
      const pairs: unknown[] = [new FieldPath('act'), act];
      if (JSON.stringify(before.groups) !== JSON.stringify(after.groups)) pairs.push(new FieldPath('groups'), after.groups);
      for (const [map, key, value] of changedEntries(before, after)) {
        pairs.push(new FieldPath(map, key), value === undefined ? deleteField() : value);
      }
      tx.update(ref, new FieldPath('updatedAtMillis'), now, ...pairs);
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
    if (!asOfficer) {
      if (g.locked || !g.selfJoin) {
        throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
      }
      const target = g.groups.find((x) => x.id === targetGroupId);
      if (g.hasLeader && target && target.memberUids.length > 0) {
        throw new UserError('NO_PERMISSION', 'Ask the group leader to approve your request.');
      }
    }
    return moveMemberToGroup(g.groups, targetUid, targetGroupId, asOfficer, meta);
  });
}

/** Sends a join request to a group whose leader must approve (when hasLeader is on). */
export async function requestJoinGroup(
  db: Firestore,
  classId: string,
  groupingId: string,
  targetGroupId: string,
  uid: string,
  name: string,
  tag: string,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (g.locked || !g.selfJoin) {
      throw new UserError('NO_PERMISSION', 'This grouping is locked.');
    }
    const target = g.groups.find((x) => x.id === targetGroupId);
    // If the group became empty in the meantime, join immediately as leader.
    if (target && target.memberUids.length === 0) {
      return moveMemberToGroup(
        g.groups,
        uid,
        targetGroupId,
        false,
        shared ? { name, classId, tag } : undefined,
      );
    }
    return requestToJoinGroup(g.groups, targetGroupId, {
      uid,
      name,
      classId,
      tag: shared ? tag : '',
      requestedAtMillis: nowMillis(),
    });
  }, uid);
}

/** Cancels the signed-in student's own pending join request. */
export async function cancelJoinRequest(
  db: Firestore,
  classId: string,
  groupingId: string,
  targetGroupId: string,
  uid: string,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (g.locked) throw new UserError('NO_PERMISSION', 'This grouping is locked.');
    return removeGroupJoinRequest(g.groups, targetGroupId, uid);
  }, uid);
}

/** Approves a pending join request (only the group's appointed leader or an officer). */
export async function approveJoinRequest(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  actorUid: string,
  requesterUid: string,
  asOfficer = false,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (!asOfficer) {
      if (g.locked) throw new UserError('NO_PERMISSION', 'This grouping is locked.');
      const slot = g.groups.find((x) => x.id === groupId);
      if (!slot || effectiveLeaderUid(slot, g.hasLeader) !== actorUid) {
        throw new UserError('NO_PERMISSION', 'Only the group leader can approve requests.');
      }
    }
    return approveGroupJoinRequest(g.groups, groupId, requesterUid, asOfficer);
  }, requesterUid);
}

/** Rejects a pending join request (only the group's appointed leader or an officer). */
export async function rejectJoinRequest(
  db: Firestore,
  classId: string,
  groupingId: string,
  groupId: string,
  actorUid: string,
  requesterUid: string,
  asOfficer = false,
  shared?: boolean,
): Promise<void> {
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (!asOfficer) {
      if (g.locked) throw new UserError('NO_PERMISSION', 'This grouping is locked.');
      const slot = g.groups.find((x) => x.id === groupId);
      if (!slot || effectiveLeaderUid(slot, g.hasLeader) !== actorUid) {
        throw new UserError('NO_PERMISSION', 'Only the group leader can reject requests.');
      }
    }
    return removeGroupJoinRequest(g.groups, groupId, requesterUid);
  }, requesterUid);
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
  const guestId = newId().slice(0, 10);
  await mutateGroups(db, classId, groupingId, shared, (g) => {
    if (!asOfficer) {
      if (g.locked || !g.selfJoin) {
        throw new UserError('NO_PERMISSION', 'This grouping is locked by an officer.');
      }
      const slot = g.groups.find((x) => x.id === groupId);
      if (!slot || !slot.memberUids.includes(actorUid)) {
        throw new UserError('NO_PERMISSION', 'Join this group first to add a guest teammate.');
      }
      if (g.hasLeader && effectiveLeaderUid(slot, true) !== actorUid) {
        throw new UserError('NO_PERMISSION', 'Only the group leader can add guests.');
      }
    }
    return addGuestToGroup(g.groups, groupId, { id: guestId, name, tag, addedByUid: actorUid }, asOfficer);
  }, guestId);
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
      if (g.hasLeader && effectiveLeaderUid(slot, true) !== actorUid) {
        throw new UserError('NO_PERMISSION', 'Only the group leader can remove guests.');
      }
    }
    return removeGuestFromGroup(g.groups, groupId, guestId);
  }, guestId);
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

/**
 * Called during class deletion (while the Mayor still holds permissions):
 * deletes shared groupings and invites hosted by this class, and unlinks this class from any it joined
 * (converting its seated members into tagged guests).
 */
export async function cleanupSharedGroupingsForDeletedClass(
  db: Firestore,
  ownerUid: string,
  classId: string,
): Promise<void> {
  const links = await getDocsFromServer(sharedGroupingLinksCol(db, classId)).catch(() => null);
  if (!links) return;
  for (const d of links.docs) {
    const sharedId = String(d.data()?.sharedId ?? d.id);
    const snap = await getDoc(sharedGroupingRef(db, sharedId)).catch(() => null);
    if (!snap?.exists()) continue;
    const g = { ...groupingFrom(snap), shared: true };
    if (g.hostClassId === classId) {
      const b = writeBatch(db);
      b.delete(sharedGroupingRef(db, sharedId));
      if (g.shareCode) b.delete(groupingInviteRef(db, g.shareCode));
      await b.commit().catch(() => undefined);
    } else if ((g.linkedClassIds ?? []).includes(classId)) {
      await unlinkSharedGrouping(db, ownerUid, classId, g, classId).catch(() => undefined);
    }
  }
}

/** Local (single-class) groupings, newest first. */
export function useLocalGroupings(db: Firestore, classId: string, enabled: boolean) {
  return useQueryList<Grouping>(
    `v2/groupings/${classId}/${enabled}`,
    enabled ? groupingsCol(db, classId) : null,
    groupingFrom,
  );
}

/** Shared cross-class groupings linked to this class, live via per-doc listeners. */
export function useSharedGroupings(db: Firestore, classId: string, enabled: boolean): Grouping[] | undefined {
  const [result, setResult] = useState<Grouping[] | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !classId) {
      setResult(undefined);
      return;
    }
    const docUnsubs = new Map<string, () => void>();
    const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const retryCounts = new Map<string, number>();
    const docsMap = new Map<string, Grouping>();
    let disposed = false;

    const emit = () => {
      if (disposed) return;
      setResult(Array.from(docsMap.values()));
    };

    const subscribeShared = (sharedId: string) => {
      if (disposed || docUnsubs.has(sharedId)) return;
      const unsub = onSnapshot(
        sharedGroupingRef(db, sharedId),
        (snap) => {
          retryCounts.delete(sharedId);
          if (!snap.exists()) {
            docsMap.delete(sharedId);
          } else {
            const raw = groupingFrom(snap);
            if (!(raw.linkedClassIds ?? []).includes(classId)) {
              docsMap.delete(sharedId);
            } else {
              const myLink = raw.linkedClasses?.[classId];
              docsMap.set(sharedId, {
                ...raw,
                shared: true,
                courseId: myLink?.courseId ?? '',
              });
            }
          }
          emit();
        },
        () => {
          unsub();
          docUnsubs.delete(sharedId);
          const attempts = retryCounts.get(sharedId) ?? 0;
          if (!disposed && attempts < 2) {
            retryCounts.set(sharedId, attempts + 1);
            const timer = setTimeout(() => {
              retryTimers.delete(sharedId);
              subscribeShared(sharedId);
            }, 800 * (attempts + 1));
            retryTimers.set(sharedId, timer);
          } else {
            docsMap.delete(sharedId);
            emit();
          }
        },
      );
      docUnsubs.set(sharedId, unsub);
    };

    const unsubLinks = onSnapshot(
      sharedGroupingLinksCol(db, classId),
      { includeMetadataChanges: true },
      (snap) => {
        // Wait until a newly created link doc is committed on the server before attaching a
        // per-doc listener to /sharedGroupings/{id}; otherwise a racing LISTEN can hit PERMISSION_DENIED.
        const activeIds = new Set(
          snap.docs
            .filter((d) => !d.metadata.hasPendingWrites)
            .map((d) => String(d.data()?.sharedId ?? d.id)),
        );
        for (const [id, unsub] of docUnsubs) {
          if (!activeIds.has(id)) {
            unsub();
            docUnsubs.delete(id);
            const timer = retryTimers.get(id);
            if (timer) {
              clearTimeout(timer);
              retryTimers.delete(id);
            }
            retryCounts.delete(id);
            docsMap.delete(id);
          }
        }
        for (const id of activeIds) {
          if (!docUnsubs.has(id) && !retryTimers.has(id)) {
            subscribeShared(id);
          }
        }
        emit();
      },
      () => setResult([]),
    );

    return () => {
      disposed = true;
      unsubLinks();
      for (const unsub of docUnsubs.values()) unsub();
      for (const timer of retryTimers.values()) clearTimeout(timer);
    };
  }, [db, classId, enabled]);

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

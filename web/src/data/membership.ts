import { queueNotice } from './notify';
import { sortNameOf } from './models';
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { ROLE_MAYOR, type ClassRoom, type Invite, type JoinRequest, type Member, type Role } from './models';
import { InviteCode } from '../domain/inviteCode';
import { Ledger } from '../domain/ledger';
import { RoleRules, can } from '../domain/permissions';
import { UserError } from './errors';
import { newId, nowMillis } from './dataEnv';
import { addOpeningToBatch, openingRecordIdFor } from './openingBalances';
import type { Actor } from './classes';
import {
  bumpSummary,
  classIdOf,
  classRef,
  explainRefusal,
  inviteRef,
  isDenied,
  joinRequestRef,
  joinRequestsCol,
  memberRef,
  membersCol,
  openingBalanceRef,
  readMyRole,
  readOpenClass,
  roleRef,
  toClassRoom,
  toInvite,
  toJoinRequest,
  toMember,
  toPendingOpeningBalance,
  toRole,
} from './paths';

/*
 * Joining, "My classes", members and roles (docs/PLAN-V2.md, "What this fixes" and "Permissions").
 */

function checkName(name: string): string {
  const t = name.trim();
  if (!t) throw new UserError('NAME_MISSING');
  if (t.length > 90) throw new UserError('NAME_TOO_LONG');
  return t;
}

// ---- Joining

/** The invite for a code, or null when the code is malformed or matches no class. */
export async function lookupInvite(db: Firestore, rawCode: string): Promise<Invite | null> {
  const code = InviteCode.normalize(rawCode);
  if (!InviteCode.isValid(code)) return null;
  const snap = await getDoc(inviteRef(db, code));
  return snap.exists() ? toInvite(snap) : null;
}

/**
 * A student enters a code: creates classes/{classId}/joinRequests/{uid} with the name they ask with.
 * An officer with MEMBERS_MANAGE approves or rejects it.
 */
export async function requestToJoin(db: Firestore, actor: Actor, rawCode: string): Promise<{ classId: string; className: string }> {
  const code = InviteCode.normalize(rawCode);
  if (!InviteCode.isValid(code)) throw new UserError('INVITE_FORMAT');
  const name = checkName(actor.name);
  const invite = await lookupInvite(db, code);
  if (!invite) throw new UserError('INVITE_NOT_FOUND');
  const { classId, className } = invite;
  if ((await getDoc(memberRef(db, classId, actor.uid))).exists()) throw new UserError('ALREADY_MEMBER');
  if ((await getDoc(joinRequestRef(db, classId, actor.uid))).exists()) throw new UserError('ALREADY_REQUESTED');
  try {
    await setDoc(joinRequestRef(db, classId, actor.uid), { uid: actor.uid, name, className, joinCode: code, requestedAtMillis: nowMillis() });
  } catch (e) {
    if (isDenied(e)) throw new UserError('JOIN_REFUSED');
    throw e;
  }
  void queueNotice(db, actor.uid, classId, { kind: 'JOIN_REQUEST', audience: 'PERMISSION', audienceId: 'MEMBERS_MANAGE', title: `${name} asked to join ${className}`, body: 'Open Members to approve or reject.' });
  return { classId, className };
}

/** The student takes back their own waiting request. */
export async function cancelJoinRequest(db: Firestore, uid: string, classId: string): Promise<void> {
  await deleteDoc(joinRequestRef(db, classId, uid));
}

/** The waiting requests of a class, oldest first (MEMBERS_MANAGE). */
export async function listJoinRequests(db: Firestore, classId: string): Promise<JoinRequest[]> {
  const snap = await getDocs(joinRequestsCol(db, classId));
  return snap.docs.map(toJoinRequest).sort((a, b) => a.requestedAtMillis - b.requestedAtMillis);
}

/**
 * Approves a request (MEMBERS_MANAGE): the member entry (the class's default role, the name the student asked
 * with) is created and the request deleted, in one batch. When the approver also manages records and the
 * student has a pending opening balance, it is applied in the same batch; otherwise a records manager's app
 * applies it later (applyPendingOpeningBalances).
 */
export async function approveJoinRequest(db: Firestore, approverUid: string, classId: string, studentUid: string): Promise<{ openingApplied: boolean }> {
  const room = await readOpenClass(db, classId);
  const reqSnap = await getDoc(joinRequestRef(db, classId, studentUid));
  if (!reqSnap.exists()) throw new UserError('REQUEST_GONE');
  const request = toJoinRequest(reqSnap);
  const batch = writeBatch(db);
  batch.set(memberRef(db, classId, studentUid), {
    uid: studentUid, name: request.name, roleId: room.defaultRoleId, joinedAtMillis: nowMillis(), excludedCourseIds: [], approvedByUid: approverUid,
  });
  batch.delete(reqSnap.ref);

  let openingApplied = false;
  if (can(await readMyRole(db, classId, approverUid), 'RECORDS_MANAGE')) {
    const entry = await getDoc(openingBalanceRef(db, classId, studentUid)).catch(() => null);
    const recordId = entry?.exists() ? await openingRecordIdFor(db, classId, studentUid) : null;
    if (entry?.exists() && recordId) {
      const pending = toPendingOpeningBalance(entry);
      const record = addOpeningToBatch(batch, db, approverUid, classId, recordId, { uid: studentUid, name: request.name }, pending.amountCentavos, pending.note);
      bumpSummary(batch, db, classId, Ledger.summaryDelta(record));
      openingApplied = true;
    }
  }
  try {
    await explainRefusal(db, classId, () => batch.commit());
  } catch (e) {
    const fresh = await getDocFromServer(reqSnap.ref).catch(() => null);
    if (fresh && !fresh.exists()) throw new UserError('REQUEST_GONE');
    throw e;
  }
  void queueNotice(db, approverUid, classId, { kind: 'JOIN_APPROVED', audience: 'USER', audienceId: studentUid, title: `You are now in ${room.name}`, body: 'Your request to join was approved.' });
  return { openingApplied };
}

/** Rejects a request (MEMBERS_MANAGE): the request is deleted. */
export async function rejectJoinRequest(db: Firestore, classId: string, studentUid: string): Promise<void> {
  await explainRefusal(db, classId, () => deleteDoc(joinRequestRef(db, classId, studentUid)));
}

// ---- "My classes"

export interface MyClass {
  classId: string;
  member: Member;
  /** undefined while loading, null when the class no longer exists (a left-over entry: call leaveClass). */
  room: ClassRoom | null | undefined;
}

export interface MyClasses {
  classes: MyClass[];
  requests: { classId: string; request: JoinRequest }[];
}

/**
 * Keeps "My classes" live: collection-group queries on members and joinRequests where uid is the user,
 * plus each approved class's own document (for its name and whether it is being deleted).
 * onChange is first called once both queries have answered.
 */
export function watchMyClasses(db: Firestore, uid: string, onChange: (value: MyClasses) => void, onError: (e: Error) => void = () => undefined): Unsubscribe {
  let entries: { classId: string; member: Member }[] | undefined;
  let requests: MyClasses['requests'] | undefined;
  const rooms = new Map<string, ClassRoom | null | undefined>();
  const roomUnsubs = new Map<string, Unsubscribe>();

  const emit = () => {
    if (!entries || !requests) return;
    onChange({ classes: entries.map((e) => ({ ...e, room: rooms.get(e.classId) })), requests });
  };

  const unMembers = onSnapshot(
    query(collectionGroup(db, 'members'), where('uid', '==', uid)),
    (snap) => {
      entries = snap.docs.map((d) => ({ classId: classIdOf(d.ref), member: toMember(d) }));
      const wanted = new Set(entries.map((e) => e.classId));
      for (const classId of wanted) {
        if (roomUnsubs.has(classId)) continue;
        rooms.set(classId, undefined);
        roomUnsubs.set(classId, onSnapshot(
          classRef(db, classId),
          (r) => { rooms.set(classId, r.exists() ? toClassRoom(r) : null); emit(); },
          // Refused only when the entry is going away (removed just now); treat as gone.
          () => { rooms.set(classId, null); emit(); },
        ));
      }
      for (const [classId, un] of roomUnsubs) {
        if (!wanted.has(classId)) { un(); roomUnsubs.delete(classId); rooms.delete(classId); }
      }
      emit();
    },
    onError,
  );

  const unRequests = onSnapshot(
    query(collectionGroup(db, 'joinRequests'), where('uid', '==', uid)),
    (snap) => {
      requests = snap.docs.map((d) => ({ classId: classIdOf(d.ref), request: toJoinRequest(d) }));
      emit();
    },
    onError,
  );

  return () => {
    unMembers();
    unRequests();
    roomUnsubs.forEach((un) => un());
    roomUnsubs.clear();
  };
}

// ---- Leaving, handing over, renaming

/**
 * The user leaves the class (only their member entry goes; their ledger records stay as the class's history).
 * Also removes an entry a deleted class left behind. The Mayor must hand over first (handOverAndLeave).
 */
export async function leaveClass(db: Firestore, uid: string, classId: string): Promise<void> {
  const room = await getDoc(classRef(db, classId)).catch(() => null);
  if (room?.exists() && room.get('ownerUid') === uid) throw new UserError('MUST_HAND_OVER');
  await deleteDoc(memberRef(db, classId, uid));
}

/**
 * The Mayor hands the class to another member and leaves, in one batch (the only ownership transfer the
 * rules allow: the old owner must be gone after the batch).
 */
export async function handOverAndLeave(db: Firestore, uid: string, classId: string, newMayorUid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(memberRef(db, classId, uid));
  batch.update(classRef(db, classId), { ownerUid: newMayorUid });
  batch.update(memberRef(db, classId, newMayorUid), { roleId: ROLE_MAYOR });
  await explainRefusal(db, classId, () => batch.commit());
}

/** The user changes the name they show in one class. */
export async function renameMeInClass(db: Firestore, uid: string, classId: string, name: string): Promise<void> {
  const clean = checkName(name);
  const current = await getDoc(memberRef(db, classId, uid));
  if (!current.exists() || current.get('name') === clean) return;
  await explainRefusal(db, classId, () => updateDoc(current.ref, { name: clean }));
}

/**
 * The user's new name on every class they are in (and on their profile when profile is given), in one batch.
 * Returns how many classes changed. Waiting requests keep the old name (requests cannot be edited).
 */
export async function renameMeEverywhere(db: Firestore, uid: string, name: string, profile?: Record<string, string>): Promise<number> {
  const clean = checkName(name);
  const entries = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)));
  const batch = writeBatch(db);
  let changed = 0;
  // With the name parts at hand, the last-name-first form changes in the same write.
  const sortName = profile ? sortNameOf(profile.firstName ?? '', profile.middleInitial ?? '', profile.lastName ?? '') : '';
  for (const d of entries.docs) {
    if (d.get('name') !== clean) {
      batch.update(d.ref, sortName ? { name: clean, sortName } : { name: clean });
      changed++;
    }
  }
  if (profile) batch.set(doc(db, 'users', uid), profile, { merge: true });
  if (changed || profile) await batch.commit();
  return changed;
}

// ---- Members (MEMBERS_MANAGE)

/** Gives a member another role. Never the locked Mayor role, never one's own role, never the owner's. */
export async function changeMemberRole(db: Firestore, actorUid: string, classId: string, memberUid: string, roleId: string): Promise<void> {
  if (memberUid === actorUid) throw new UserError('OWN_ROLE');
  const room = await readOpenClass(db, classId);
  if (memberUid === room.ownerUid) throw new UserError('OWNER_ROLE');
  const role = await getDoc(roleRef(db, classId, roleId));
  if (role.exists() && role.get('locked') === true) throw new UserError('ROLE_LOCKED');
  await explainRefusal(db, classId, () => updateDoc(memberRef(db, classId, memberUid), { roleId }));
}

/** The courses a member does not take. */
export async function setMemberCourses(db: Firestore, classId: string, memberUid: string, excludedCourseIds: string[]): Promise<void> {
  await explainRefusal(db, classId, () => updateDoc(memberRef(db, classId, memberUid), { excludedCourseIds: [...new Set(excludedCourseIds)] }));
}

/** Removes someone else from the class. Their records stay. The Mayor cannot be removed. */
export async function removeMember(db: Firestore, actorUid: string, classId: string, memberUid: string): Promise<void> {
  if (memberUid === actorUid) throw new UserError('OWN_ROLE', 'Use Leave class to leave the class yourself.');
  const room = await readOpenClass(db, classId);
  if (memberUid === room.ownerUid) throw new UserError('OWNER_ROLE', 'The Mayor cannot be removed.');
  await explainRefusal(db, classId, () => deleteDoc(memberRef(db, classId, memberUid)));
}

// ---- Roles (ROLES_MANAGE)

/**
 * Creates a role (empty id) or saves changes to one. Locked roles and the role the user holds are refused.
 * Returns the role id.
 */
export async function saveRole(db: Firestore, actorUid: string, classId: string, role: Role, existing: Role[]): Promise<string> {
  if (role.locked) throw new UserError('ROLE_LOCKED');
  if (!RoleRules.isNameValid(role.name, existing, role.id)) throw new UserError('ROLE_NAME');
  if (role.id) {
    const me = await getDoc(memberRef(db, classId, actorUid));
    if (me.get('roleId') === role.id) throw new UserError('EDIT_OWN_ROLE');
  }
  const id = role.id || newId();
  const data = { name: role.name.trim(), colorHex: role.colorHex, permissions: RoleRules.sanitize(role.permissions), locked: false };
  await explainRefusal(db, classId, () => setDoc(roleRef(db, classId, id), data));
  return id;
}

/** Changes the tag color of the locked role (the Mayor's). Only its holder may; nothing else on it can change. */
export async function setLockedRoleColor(db: Firestore, classId: string, roleId: string, colorHex: string): Promise<void> {
  await explainRefusal(db, classId, () => updateDoc(roleRef(db, classId, roleId), { colorHex }));
}

/** Deletes a role and moves everyone who held it to the class's default role, in one batch. */
export async function deleteRole(db: Firestore, classId: string, roleId: string): Promise<void> {
  const room = await readOpenClass(db, classId);
  const snap = await getDoc(roleRef(db, classId, roleId));
  if (!snap.exists()) return;
  const role = toRole(snap);
  if (role.locked) throw new UserError('ROLE_LOCKED');
  if (!RoleRules.canDelete(role, room.defaultRoleId)) throw new UserError('ROLE_DEFAULT');
  const holders = await getDocs(query(membersCol(db, classId), where('roleId', '==', roleId)));
  if (holders.size > 499) throw new UserError('TOO_MANY_MEMBERS');
  const batch = writeBatch(db);
  holders.docs.forEach((d) => batch.update(d.ref, { roleId: room.defaultRoleId }));
  batch.delete(snap.ref);
  await explainRefusal(db, classId, () => batch.commit());
}

import { addDoc, collection, deleteDoc, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import {
  ROLE_MAYOR,
  ROLE_MEMBER,
  newClassRoom,
  newMember,
  newRecord,
  type ClassMembership,
  type ClassRoom,
  type LedgerRecord,
  type Role,
} from './models';
import { DefaultRoles, RoleRules } from '../domain/permissions';
import { InviteCode } from '../domain/inviteCode';
import { Ledger } from '../domain/ledger';

/*
 * Classes, invites, "My classes", members, roles and courses: the same documents and batches as the
 * Android app's ClassRepository, MemberRepository, RoleRepository and CourseRepository.
 */

const classes = collection(db, 'classes');
const invites = collection(db, 'invites');
export const membershipsOf = (uid: string) => collection(db, 'users', uid, 'memberships');
export const classDoc = (classId: string) => doc(db, 'classes', classId);
export const membersOf = (classId: string) => collection(db, 'classes', classId, 'members');
export const rolesOf = (classId: string) => collection(db, 'classes', classId, 'roles');
export const coursesOf = (classId: string) => collection(db, 'classes', classId, 'courses');

const MAX_CODE_TRIES = 5;

const inviteData = (classId: string, className: string, defaultRoleId: string) => ({ classId, className, defaultRoleId });

async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < MAX_CODE_TRIES; i++) {
    const code = InviteCode.generate();
    if (!(await getDoc(doc(invites, code))).exists()) return code;
  }
  throw new Error('Could not generate an unused invite code. Try again.');
}

/**
 * Creates a class with the default roles, makes the creator its Mayor and publishes an invite code.
 * Everything is written in one batch, so a class is never left half-created.
 */
export async function createClass(name: string, description: string, accentColor: string, ownerUid: string, ownerName: string): Promise<string> {
  const code = await uniqueInviteCode();
  const classRef = doc(classes);
  const now = Date.now();
  const room: ClassRoom = newClassRoom({
    name: name.trim(),
    description: description.trim(),
    ownerUid,
    accentColor,
    inviteCode: code,
    defaultRoleId: ROLE_MEMBER,
    createdAtMillis: now,
  });
  const batch = writeBatch(db);
  batch.set(classRef, room);
  for (const role of DefaultRoles.all()) batch.set(doc(rolesOf(classRef.id), role.id), role);
  batch.set(doc(membersOf(classRef.id), ownerUid), newMember({ name: ownerName, roleId: ROLE_MAYOR, joinedAtMillis: now }));
  batch.set(doc(invites, code), inviteData(classRef.id, room.name, room.defaultRoleId));
  batch.set(doc(membershipsOf(ownerUid), classRef.id), { classId: '', className: room.name, joinedAtMillis: now } satisfies ClassMembership);
  await batch.commit();
  return classRef.id;
}

/**
 * Joins the class that owns the code. New members always start in the class's default role;
 * the security rules enforce that, so nobody can join as an officer. Returns the class id.
 */
export async function joinClass(rawCode: string, uid: string, displayName: string): Promise<string> {
  const code = InviteCode.normalize(rawCode);
  if (!InviteCode.isValid(code)) throw new Error(`Invite codes have ${InviteCode.LENGTH} letters and numbers.`);
  const invite = await getDoc(doc(invites, code));
  if (!invite.exists()) throw new Error('That code does not match any class.');
  const classId: string = invite.get('classId') ?? '';
  const className: string = invite.get('className') ?? '';
  const roleId: string = (invite.get('defaultRoleId') as string | undefined)?.trim() || ROLE_MEMBER;
  // An officer can remove a student but cannot delete the student's own list entry, so an entry
  // alone does not mean the student is still in the class: check the member document too.
  if ((await getDoc(doc(membershipsOf(uid), classId))).exists() && (await getDoc(doc(membersOf(classId), uid))).exists()) {
    throw new Error(`You are already in ${className}.`);
  }

  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(membersOf(classId), uid), { name: displayName, roleId, joinedAtMillis: now, excludedCourseIds: [], joinCode: code });
  batch.set(doc(membershipsOf(uid), classId), { classId: '', className, joinedAtMillis: now } satisfies ClassMembership);
  await batch.commit();
  return classId;
}

/** The name of the class an invite code belongs to, or null when the code matches no class. */
export async function lookupInvite(rawCode: string): Promise<string | null> {
  const code = InviteCode.normalize(rawCode);
  if (!InviteCode.isValid(code)) return null;
  const invite = await getDoc(doc(invites, code));
  return invite.exists() ? (invite.get('className') as string | undefined)?.trim() || 'this class' : null;
}

/** Replaces the class's invite code. The old code stops working; people already in the class stay. */
export async function regenerateInviteCode(room: ClassRoom): Promise<string> {
  const newCode = await uniqueInviteCode();
  const batch = writeBatch(db);
  if (room.inviteCode) batch.delete(doc(invites, room.inviteCode));
  batch.set(doc(invites, newCode), inviteData(room.id, room.name, room.defaultRoleId));
  batch.update(classDoc(room.id), { inviteCode: newCode });
  await batch.commit();
  return newCode;
}

/** Saves class settings and keeps the class name in step in the invite and in the editor's own list. */
export async function updateSettings(room: ClassRoom, editorUid: string): Promise<void> {
  const name = room.name.trim();
  const batch = writeBatch(db);
  batch.update(classDoc(room.id), {
    name,
    description: room.description.trim(),
    accentColor: room.accentColor,
    ledgerEnabled: room.ledgerEnabled,
    scheduleEnabled: room.scheduleEnabled,
    contentsEnabled: room.contentsEnabled,
    scheduleIcons: room.scheduleIcons,
    scheduleColors: room.scheduleColors,
    contentIcons: room.contentIcons,
    contentColors: room.contentColors,
  });
  if (room.inviteCode) batch.update(doc(invites, room.inviteCode), { className: name });
  batch.set(doc(membershipsOf(editorUid), room.id), { className: name }, { merge: true });
  await batch.commit();
}

/**
 * Removes the class from the user's own list after they were removed from it or it was deleted.
 * It first asks the server whether the user's member entry is really gone: a passing refusal (for
 * example while signing out) must not drop a class the user is still in. Offline, nothing is removed.
 */
export async function forgetMembership(uid: string, classId: string): Promise<void> {
  if ((await getDocFromServer(doc(membersOf(classId), uid))).exists()) return;
  await deleteDoc(doc(membershipsOf(uid), classId));
}

/**
 * Puts a class back on the user's own list when its entry is missing although they are still a member
 * (an older version could drop it after a passing refusal). Asks the server, since the cache cannot tell.
 */
export async function restoreMembership(uid: string, classId: string, className: string): Promise<void> {
  const entryRef = doc(membershipsOf(uid), classId);
  const [entry, member] = await Promise.all([getDocFromServer(entryRef), getDocFromServer(doc(membersOf(classId), uid))]);
  if (entry.exists() || !member.exists()) return;
  const joinedAtMillis = (member.get('joinedAtMillis') as number | undefined) ?? Date.now();
  await setDoc(entryRef, { classId: '', className, joinedAtMillis } satisfies ClassMembership);
}

/** The member leaves on their own. Their ledger records stay, since they are the class's history. */
export async function leaveClass(classId: string, uid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(membersOf(classId), uid));
  batch.delete(doc(membershipsOf(uid), classId));
  await batch.commit();
}

/** The Mayor leaves: the chosen member becomes the owner and Mayor in the same batch, so the class always has a Mayor. */
export async function handOverAndLeave(classId: string, uid: string, newMayorUid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(membersOf(classId), uid));
  batch.delete(doc(membershipsOf(uid), classId));
  batch.update(classDoc(classId), { ownerUid: newMayorUid });
  batch.update(doc(membersOf(classId), newMayorUid), { roleId: ROLE_MAYOR });
  await batch.commit();
}

/** Firestore takes at most 500 writes in one batch. */
const BATCH_LIMIT = 450;

/**
 * The Mayor deletes the class for everyone, once every balance is zero and the class fund is empty
 * (checked again here against the server). Apps cannot delete a document with everything inside it, so
 * this goes document by document: first the records (in one batch when they fit, so stopping halfway never
 * leaves half a ledger), schedule, contents, courses and photo; then the done marks, members, roles,
 * invite code and the class itself in one last batch, as the security rules require. Until that last batch
 * the class still works, and deleting again picks up where it stopped. Other members' "My classes"
 * entries are theirs alone: each app drops the class the next time they open it.
 */
export async function deleteClass(classId: string, ownerUid: string): Promise<void> {
  const fromServer = (name: string) => getDocsFromServer(collection(db, 'classes', classId, name));
  const [room, records, schedule, contents, courses, progress, members, roles] = await Promise.all([
    getDocFromServer(classDoc(classId)),
    fromServer('records'),
    fromServer('schedule'),
    fromServer('contents'),
    fromServer('courses'),
    fromServer('progress'),
    fromServer('members'),
    fromServer('roles'),
  ]);
  if (room.get('ownerUid') !== ownerUid) throw new Error('Only the Mayor can delete the class.');
  if (!Ledger.canCloseBooks(records.docs.map((d) => newRecord(d.data() as Partial<LedgerRecord>)))) {
    throw new Error('Everyone must be settled and the class fund must be empty before the class can be deleted.');
  }

  const first = [...records.docs, ...schedule.docs, ...contents.docs, ...courses.docs].map((d) => d.ref);
  first.push(doc(db, 'classPhotos', classId));
  for (let i = 0; i < first.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    first.slice(i, i + BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  // The invite code goes too, but only if it really points to this class (the rules check that).
  const code = room.get('inviteCode') as string | undefined;
  const invite = code ? await getDocFromServer(doc(invites, code)) : null;
  const last = writeBatch(db);
  if (invite?.exists() && invite.get('classId') === classId) last.delete(invite.ref);
  [...progress.docs, ...members.docs, ...roles.docs].forEach((d) => last.delete(d.ref));
  last.delete(doc(membershipsOf(ownerUid), classId));
  last.delete(classDoc(classId));
  await last.commit();
}

// ---- Members ----

export function setRole(classId: string, uid: string, roleId: string): Promise<void> {
  return updateDoc(doc(membersOf(classId), uid), { roleId });
}

export function setExcludedCourses(classId: string, uid: string, courseIds: string[]): Promise<void> {
  return updateDoc(doc(membersOf(classId), uid), { excludedCourseIds: [...new Set(courseIds)] });
}

export function removeMember(classId: string, uid: string): Promise<void> {
  return deleteDoc(doc(membersOf(classId), uid));
}

// ---- Roles ----

/** Creates a role (blank id) or updates an existing one. Locked roles are refused. */
export async function saveRole(classId: string, role: Role): Promise<void> {
  if (!RoleRules.canEdit(role)) throw new Error(`The ${role.name} role cannot be changed.`);
  const clean: Role = { ...role, permissions: RoleRules.sanitize(role.permissions) };
  if (!role.id) await addDoc(rolesOf(classId), clean);
  else await setDoc(doc(rolesOf(classId), role.id), clean);
}

/** Deletes a role and moves everyone who had it to the default role, all in one batch. */
export async function deleteRole(classId: string, role: Role, defaultRoleId: string): Promise<void> {
  if (!RoleRules.canDelete(role, defaultRoleId)) throw new Error(`The ${role.name} role cannot be deleted.`);
  const affected = await getDocs(query(membersOf(classId), where('roleId', '==', role.id)));
  const batch = writeBatch(db);
  affected.docs.forEach((d) => batch.update(d.ref, { roleId: defaultRoleId }));
  batch.delete(doc(rolesOf(classId), role.id));
  await batch.commit();
}

// ---- Courses ----

export async function addCourse(classId: string, name: string): Promise<void> {
  await addDoc(coursesOf(classId), { id: '', name: name.trim() });
}

export function renameCourse(classId: string, courseId: string, name: string): Promise<void> {
  return updateDoc(doc(coursesOf(classId), courseId), { name: name.trim() });
}

export function setCourseColor(classId: string, courseId: string, color: string): Promise<void> {
  return updateDoc(doc(coursesOf(classId), courseId), { color });
}

/**
 * Deletes a course. Its timetable meetings go with it when the person may edit the timetable
 * (the rules ask for that permission); otherwise they stay in the data and the screens hide them.
 */
export async function deleteCourse(classId: string, courseId: string, withMeetings = false): Promise<void> {
  if (withMeetings) {
    const meetings = await getDocs(query(collection(db, 'classes', classId, 'meetings'), where('courseId', '==', courseId)));
    for (let i = 0; i < meetings.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of meetings.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
  }
  await deleteDoc(doc(coursesOf(classId), courseId));
}

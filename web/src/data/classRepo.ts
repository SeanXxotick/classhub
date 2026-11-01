import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import {
  ROLE_MAYOR,
  ROLE_MEMBER,
  newClassRoom,
  newMember,
  type ClassMembership,
  type ClassRoom,
  type Role,
} from './models';
import { DefaultRoles, RoleRules } from '../domain/permissions';
import { InviteCode } from '../domain/inviteCode';

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
  if ((await getDoc(doc(membershipsOf(uid), classId))).exists()) throw new Error(`You are already in ${className}.`);

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

/** Removes the class from the user's own list, for example after they were removed from it. */
export function forgetMembership(uid: string, classId: string): Promise<void> {
  return deleteDoc(doc(membershipsOf(uid), classId));
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

export function deleteCourse(classId: string, courseId: string): Promise<void> {
  return deleteDoc(doc(coursesOf(classId), courseId));
}

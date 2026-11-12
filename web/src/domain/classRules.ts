import type { Course, Member, Role } from '../data/models';

export const ClassRules = {
  MAX_NAME: 40,
  MAX_DESCRIPTION: 80,

  /** Returns an error message, or null when the class name can be saved. */
  checkName(name: string): string | null {
    if (!name.trim()) return 'Give the class a name.';
    if (name.trim().length > ClassRules.MAX_NAME) return `Keep the class name under ${ClassRules.MAX_NAME} characters.`;
    return null;
  },
};

export const MemberRules = {
  /** The class owner (Mayor) cannot be given another role, and nobody changes their own role. */
  canChangeRole(actorUid: string, target: Member, ownerUid: string): boolean {
    return target.id !== ownerUid && target.id !== actorUid;
  },

  /** The owner cannot be removed, and members are not removed by themselves from this screen. */
  canRemove(actorUid: string, target: Member, ownerUid: string): boolean {
    return target.id !== ownerUid && target.id !== actorUid;
  },

  /** The locked Mayor role belongs to the owner only, so it is never offered when assigning roles. */
  assignableRoles(roles: Role[]): Role[] {
    return roles.filter((r) => !r.locked);
  },

  /** Anyone may leave, except that the owner (the Mayor) must first hand the class to someone else. */
  mustHandOver(uid: string, ownerUid: string): boolean {
    return uid === ownerUid;
  },

  /** Who the leaving Mayor can hand the class to: every other member, by name. */
  mayorCandidates(uid: string, members: Member[]): Member[] {
    return sortByName(members.filter((m) => m.id !== uid));
  },

  /** How many members currently hold the role. */
  holders(role: Role, members: Member[]): number {
    return members.filter((m) => m.roleId === role.id).length;
  },
};

export const CourseRules = {
  MAX_NAME: 80,

  /** A course name must be non-blank, short enough, and not already used (ignoring case). */
  isNameValid(name: string, existing: Course[], editingId = ''): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > CourseRules.MAX_NAME) return false;
    return !existing.some((c) => c.id !== editingId && c.name.toLowerCase() === trimmed.toLowerCase());
  },

  /** How many members take the course, that is, do not exclude it. */
  takers(course: Course, members: Member[]): number {
    return members.filter((m) => !m.excludedCourseIds.includes(course.id)).length;
  },
};

/** Sorted by lowercase name, keeping the original order for ties (like Kotlin's sortedBy). */
export function sortByName<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => compareStrings(a.name.toLowerCase(), b.name.toLowerCase()));
}

/** Plain code-point order, the same as Kotlin's String.compareTo. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/*
 * Pure domain logic for Project & Lab Groupings (inside the Members tab).
 * Supports per-group capacities (e.g. 10 and 11 in the same grouping),
 * guest teammates from other sections (G2) or irregulars, and plain-text export.
 */

export const GROUPING_TITLE_MAX = 120;
export const GROUPING_NOTE_MAX = 300;
export const GROUP_NAME_MAX = 60;
export const GUEST_NAME_MAX = 60;
export const GUEST_TAG_MAX = 24;
export const GROUPING_MAX_GROUPS = 50;

export interface GuestMember {
  id: string;
  name: string;
  /** Optional label like "G2" or "Irregular". */
  tag: string;
  addedByUid: string;
}

export interface GroupSlot {
  id: string;
  name: string;
  /** Maximum total members (ClassHub members + guests). 0 means unlimited. */
  maxSize: number;
  memberUids: string[];
  guests: GuestMember[];
}

export interface Grouping {
  id: string;
  title: string;
  /** Course id, or '' for the whole class. */
  courseId: string;
  note: string;
  selfJoin: boolean;
  locked: boolean;
  groups: GroupSlot[];
  createdByUid: string;
  createdAtMillis: number;
  updatedAtMillis: number;
}

export const newGrouping = (g: Partial<Grouping>): Grouping => ({
  id: '',
  title: '',
  courseId: '',
  note: '',
  selfJoin: true,
  locked: false,
  groups: [],
  createdByUid: '',
  createdAtMillis: 0,
  updatedAtMillis: 0,
  ...g,
});

/** Total headcount of a group (ClassHub members + guest teammates). */
export function groupSize(group: GroupSlot): number {
  return group.memberUids.length + group.guests.length;
}

/** True when the group has reached its per-group cap (maxSize > 0). */
export function isGroupFull(group: GroupSlot): boolean {
  return group.maxSize > 0 && groupSize(group) >= group.maxSize;
}

/** Remaining open slots in a group, or null when unlimited. */
export function groupRemaining(group: GroupSlot): number | null {
  return group.maxSize > 0 ? Math.max(0, group.maxSize - groupSize(group)) : null;
}

/** The group a ClassHub member currently belongs to in this grouping, if any. */
export function findMemberGroup(groups: GroupSlot[], uid: string): GroupSlot | undefined {
  return groups.find((g) => g.memberUids.includes(uid));
}

/**
 * ClassHub member UIDs who are eligible for this grouping (take its course)
 * and are not yet placed in any group.
 */
export function ungroupedMemberIds(
  groups: GroupSlot[],
  eligibleUids: string[],
): string[] {
  const placed = new Set<string>();
  for (const g of groups) {
    for (const uid of g.memberUids) placed.add(uid);
  }
  return eligibleUids.filter((uid) => !placed.has(uid));
}

/**
 * Places `uid` into `targetGroupId`, removing them from any other group in the same grouping.
 * Throws an Error message if the target group does not exist or is already full (unless `ignoreCap` is true).
 */
export function moveMemberToGroup(
  groups: GroupSlot[],
  uid: string,
  targetGroupId: string,
  ignoreCap = false,
): GroupSlot[] {
  const target = groups.find((g) => g.id === targetGroupId);
  if (!target) throw new Error('That group no longer exists.');
  if (target.memberUids.includes(uid)) return groups;
  if (!ignoreCap && isGroupFull(target)) {
    throw new Error(`${target.name} is already full.`);
  }
  return groups.map((g) => {
    const without = g.memberUids.filter((id) => id !== uid);
    if (g.id !== targetGroupId) return without.length === g.memberUids.length ? g : { ...g, memberUids: without };
    return { ...g, memberUids: [...without, uid] };
  });
}

/** Removes `uid` from whichever group they belong to. */
export function removeMemberFromGroups(groups: GroupSlot[], uid: string): GroupSlot[] {
  return groups.map((g) =>
    g.memberUids.includes(uid) ? { ...g, memberUids: g.memberUids.filter((id) => id !== uid) } : g,
  );
}

/** Adds a guest teammate to a specific group, checking duplicates and capacity. */
export function addGuestToGroup(
  groups: GroupSlot[],
  groupId: string,
  guest: GuestMember,
  ignoreCap = false,
): GroupSlot[] {
  const name = guest.name.trim().slice(0, GUEST_NAME_MAX);
  const tag = guest.tag.trim().slice(0, GUEST_TAG_MAX);
  if (!name) throw new Error('Enter the teammate’s name.');
  const target = groups.find((g) => g.id === groupId);
  if (!target) throw new Error('That group no longer exists.');
  if (!ignoreCap && isGroupFull(target)) {
    throw new Error(`${target.name} is already full.`);
  }
  const lower = name.toLowerCase();
  if (target.guests.some((x) => x.name.trim().toLowerCase() === lower)) {
    throw new Error(`${name} is already listed in ${target.name}.`);
  }
  const clean: GuestMember = { id: guest.id, name, tag, addedByUid: guest.addedByUid };
  return groups.map((g) => (g.id === groupId ? { ...g, guests: [...g.guests, clean] } : g));
}

/** Removes a guest teammate by id from a specific group. */
export function removeGuestFromGroup(groups: GroupSlot[], groupId: string, guestId: string): GroupSlot[] {
  return groups.map((g) =>
    g.id === groupId ? { ...g, guests: g.guests.filter((x) => x.id !== guestId) } : g,
  );
}

/**
 * Evenly distributes `uids` into groups that still have room (smallest group first).
 * Returns the updated groups and how many students were placed.
 */
export function autoAssignMembers(
  groups: GroupSlot[],
  uids: string[],
): { groups: GroupSlot[]; assigned: number } {
  const next = groups.map((g) => ({ ...g, memberUids: [...g.memberUids] }));
  let assigned = 0;
  for (const uid of uids) {
    if (next.some((g) => g.memberUids.includes(uid))) continue;
    const open = next.filter((g) => !isGroupFull(g));
    if (open.length === 0) break;
    open.sort((a, b) => groupSize(a) - groupSize(b));
    open[0].memberUids.push(uid);
    assigned++;
  }
  return { groups: next, assigned };
}

/** Builds initial group slots with optional per-group capacities. */
export function buildInitialGroups(
  count: number,
  defaultMaxSize: number,
  idFor: (index: number) => string,
  customSizes?: number[],
): GroupSlot[] {
  const n = Math.min(GROUPING_MAX_GROUPS, Math.max(1, Math.trunc(count)));
  const fallback = Math.max(0, Math.trunc(defaultMaxSize));
  return Array.from({ length: n }, (_, i) => ({
    id: idFor(i),
    name: `Group ${i + 1}`,
    maxSize: customSizes && customSizes[i] !== undefined ? Math.max(0, Math.trunc(customSizes[i])) : fallback,
    memberUids: [],
    guests: [],
  }));
}

/**
 * Formats a grouping as clean plain text ready to paste into Messenger, email, or a professor's form.
 */
export function formatGroupingExport(
  grouping: Grouping,
  courseName: string,
  memberNameOf: (uid: string) => string,
): string {
  const header = courseName ? `${grouping.title} (${courseName})` : grouping.title;
  const lines: string[] = [header];
  if (grouping.note.trim()) lines.push(grouping.note.trim());
  for (const g of grouping.groups) {
    const total = groupSize(g);
    const cap = g.maxSize > 0 ? `${total}/${g.maxSize}` : `${total}`;
    lines.push('', `${g.name} (${cap})`);
    const roster: string[] = [
      ...g.memberUids.map((uid) => memberNameOf(uid)).sort((a, b) => a.localeCompare(b)),
      ...g.guests.map((guest) => (guest.tag ? `${guest.name} (${guest.tag})` : guest.name)),
    ];
    if (roster.length === 0) {
      lines.push('  (No members yet)');
    } else {
      roster.forEach((entry, idx) => lines.push(`  ${idx + 1}. ${entry}`));
    }
  }
  return lines.join('\n');
}

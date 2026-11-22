/*
 * Pure domain logic for Project & Lab Groupings (inside the Members tab).
 * Supports single-class groupings, cross-class shared groupings (e.g. G1 + G2),
 * per-group capacities (e.g. 10 and 11 in the same grouping),
 * guest teammates (Irregulars), and plain-text export.
 */

export const GROUPING_TITLE_MAX = 120;
export const GROUPING_NOTE_MAX = 300;
export const GROUP_NAME_MAX = 60;
export const GUEST_NAME_MAX = 60;
export const GUEST_TAG_MAX = 24;
export const GROUPING_MAX_GROUPS = 50;
export const SHARED_MAX_CLASSES = 4;

export interface GuestMember {
  id: string;
  name: string;
  /** Optional label like "G2" or "Irregular". */
  tag: string;
  addedByUid: string;
}

export interface MemberMeta {
  name: string;
  classId: string;
  /** Short section label like "G1" or "G2". */
  tag: string;
}

export interface SharedRosterEntry {
  uid: string;
  name: string;
}

export interface SharedClassLink {
  name: string;
  tag: string;
  courseId: string;
  /** The class's default accent color hex (e.g. "#0F766E"). */
  accentColor?: string;
  /** Snapshot of eligible members of this class, so partner classes can see who is still ungrouped. */
  roster?: SharedRosterEntry[];
}

export interface GroupJoinRequest {
  uid: string;
  name: string;
  classId: string;
  tag: string;
  requestedAtMillis: number;
}

export interface GroupSlot {
  id: string;
  name: string;
  /** Maximum total members (ClassHub members + guests). 0 means unlimited. */
  maxSize: number;
  memberUids: string[];
  /** Stored for shared groupings so partner classes see names & section tags without reading each other's rosters. */
  memberMeta?: Record<string, MemberMeta>;
  /** UID of the group leader (first to join by default; can be passed anytime). */
  leaderUid?: string;
  /** Pending join requests awaiting leader approval (used when hasLeader is on). */
  joinRequests?: GroupJoinRequest[];
  guests: GuestMember[];
}

export interface Grouping {
  id: string;
  title: string;
  /** Course id for the viewing class, or '' for the whole class. */
  courseId: string;
  note: string;
  selfJoin: boolean;
  locked: boolean;
  /** Optional group leader mode — can be toggled on/off anytime. */
  hasLeader?: boolean;
  groups: GroupSlot[];
  createdByUid: string;
  createdAtMillis: number;
  updatedAtMillis: number;
  /** Present when this grouping is a top-level shared cross-class grouping. */
  shared?: boolean;
  hostClassId?: string;
  shareCode?: string;
  linkedClassIds?: string[];
  linkedClasses?: Record<string, SharedClassLink>;
}

export const newGrouping = (g: Partial<Grouping>): Grouping => ({
  id: '',
  title: '',
  courseId: '',
  note: '',
  selfJoin: true,
  locked: false,
  hasLeader: false,
  groups: [],
  createdByUid: '',
  createdAtMillis: 0,
  updatedAtMillis: 0,
  ...g,
});

/** A linked class as "Name (Tag)", leaving the tag out when the name already shows it ("BSIT 3A-G1", "BSIT 3A (G1)"). */
export function classTagLabel(name: string, tag: string): string {
  const t = tag.trim();
  if (!t) return name;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, 'i').test(name) ? name : `${name} (${t})`;
}

/** Active leader UID for a group when `hasLeader` is enabled (defaults to the first member). */
export function effectiveLeaderUid(group: GroupSlot, hasLeader?: boolean): string {
  if (!hasLeader) return '';
  if (group.leaderUid && group.memberUids.includes(group.leaderUid)) return group.leaderUid;
  return group.memberUids[0] ?? '';
}

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
 * Optionally stores `meta` (display name + section tag) for cross-class shared groupings.
 */
export function moveMemberToGroup(
  groups: GroupSlot[],
  uid: string,
  targetGroupId: string,
  ignoreCap = false,
  meta?: MemberMeta,
): GroupSlot[] {
  const target = groups.find((g) => g.id === targetGroupId);
  if (!target) throw new Error('That group no longer exists.');
  if (target.memberUids.includes(uid)) return groups;
  if (!ignoreCap && isGroupFull(target)) {
    throw new Error(`${target.name} is already full.`);
  }
  // Preserve existing meta if moving an already-placed member without new meta
  let carryMeta = meta;
  if (!carryMeta) {
    for (const g of groups) {
      if (g.memberMeta?.[uid]) {
        carryMeta = g.memberMeta[uid];
        break;
      }
    }
  }
  return groups.map((g) => {
    const without = g.memberUids.filter((id) => id !== uid);
    const nextMeta = g.memberMeta ? { ...g.memberMeta } : undefined;
    if (nextMeta && uid in nextMeta && g.id !== targetGroupId) delete nextMeta[uid];
    const nextReqs = g.joinRequests ? g.joinRequests.filter((r) => r.uid !== uid) : undefined;
    if (g.id !== targetGroupId) {
      if (without.length === g.memberUids.length && (!nextReqs || nextReqs.length === g.joinRequests?.length)) return g;
      const nextLeader = g.leaderUid === uid ? (without[0] ?? '') : g.leaderUid;
      return {
        ...g,
        memberUids: without,
        ...(nextMeta ? { memberMeta: nextMeta } : {}),
        ...(nextLeader !== undefined ? { leaderUid: nextLeader } : {}),
        ...(nextReqs ? { joinRequests: nextReqs } : {}),
      };
    }
    const targetMeta = carryMeta ? { ...(nextMeta ?? {}), [uid]: carryMeta } : nextMeta;
    const nextUids = [...without, uid];
    const hasValidLeader = !!g.leaderUid && nextUids.includes(g.leaderUid);
    return {
      ...g,
      memberUids: nextUids,
      leaderUid: hasValidLeader ? g.leaderUid : uid,
      ...(targetMeta ? { memberMeta: targetMeta } : {}),
      ...(nextReqs ? { joinRequests: nextReqs } : {}),
    };
  });
}

/** Removes `uid` from whichever group they belong to, passing leadership to the next member if needed. */
export function removeMemberFromGroups(groups: GroupSlot[], uid: string): GroupSlot[] {
  return groups.map((g) => {
    if (!g.memberUids.includes(uid)) return g;
    const remaining = g.memberUids.filter((id) => id !== uid);
    const nextMeta = g.memberMeta ? { ...g.memberMeta } : undefined;
    if (nextMeta) delete nextMeta[uid];
    const nextLeader = g.leaderUid === uid ? (remaining[0] ?? '') : g.leaderUid;
    return {
      ...g,
      memberUids: remaining,
      ...(nextMeta ? { memberMeta: nextMeta } : {}),
      ...(nextLeader !== undefined ? { leaderUid: nextLeader } : {}),
    };
  });
}

/** Passes leadership of `groupId` to another ClassHub member already in that group. */
export function passGroupLeadership(groups: GroupSlot[], groupId: string, newLeaderUid: string): GroupSlot[] {
  const target = groups.find((g) => g.id === groupId);
  if (!target) throw new Error('That group no longer exists.');
  if (!target.memberUids.includes(newLeaderUid)) {
    throw new Error('Only a member of this group can be its leader.');
  }
  return groups.map((g) => (g.id === groupId ? { ...g, leaderUid: newLeaderUid } : g));
}

/** Submits a pending join request to `groupId` for leader approval. */
export function requestToJoinGroup(
  groups: GroupSlot[],
  groupId: string,
  req: GroupJoinRequest,
): GroupSlot[] {
  const target = groups.find((g) => g.id === groupId);
  if (!target) throw new Error('That group no longer exists.');
  if (target.memberUids.includes(req.uid)) return groups;
  if (isGroupFull(target)) throw new Error(`${target.name} is already full.`);
  const existing = target.joinRequests ?? [];
  if (existing.some((r) => r.uid === req.uid)) return groups;
  return groups.map((g) =>
    g.id === groupId ? { ...g, joinRequests: [...existing, req] } : g,
  );
}

/** Cancels or rejects a pending join request from `groupId`. */
export function removeGroupJoinRequest(groups: GroupSlot[], groupId: string, uid: string): GroupSlot[] {
  return groups.map((g) =>
    g.id === groupId && g.joinRequests
      ? { ...g, joinRequests: g.joinRequests.filter((r) => r.uid !== uid) }
      : g,
  );
}

/** Approves a pending join request in `groupId`, moving the student in and clearing their pending requests. */
export function approveGroupJoinRequest(
  groups: GroupSlot[],
  groupId: string,
  uid: string,
  ignoreCap = false,
): GroupSlot[] {
  const target = groups.find((g) => g.id === groupId);
  if (!target) throw new Error('That group no longer exists.');
  const req = (target.joinRequests ?? []).find((r) => r.uid === uid);
  if (!req) throw new Error('That join request is no longer pending.');
  const meta: MemberMeta | undefined = req.tag || req.classId
    ? { name: req.name, classId: req.classId, tag: req.tag }
    : undefined;
  return moveMemberToGroup(groups, uid, groupId, ignoreCap, meta);
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
  metaFor?: (uid: string) => MemberMeta | undefined,
): { groups: GroupSlot[]; assigned: number } {
  const next = groups.map((g) => ({
    ...g,
    memberUids: [...g.memberUids],
    ...(g.memberMeta ? { memberMeta: { ...g.memberMeta } } : {}),
  }));
  let assigned = 0;
  for (const uid of uids) {
    if (next.some((g) => g.memberUids.includes(uid))) continue;
    const open = next.filter((g) => !isGroupFull(g));
    if (open.length === 0) break;
    open.sort((a, b) => groupSize(a) - groupSize(b));
    if (!open[0].leaderUid || !open[0].memberUids.includes(open[0].leaderUid)) {
      open[0].leaderUid = uid;
    }
    open[0].memberUids.push(uid);
    const meta = metaFor?.(uid);
    if (meta) {
      open[0].memberMeta = { ...(open[0].memberMeta ?? {}), [uid]: meta };
    }
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
  memberNameOf: (uid: string, slot: GroupSlot) => string,
): string {
  const header = courseName ? `${grouping.title} (${courseName})` : grouping.title;
  const lines: string[] = [header];
  if (grouping.note.trim()) lines.push(grouping.note.trim());
  for (const g of grouping.groups) {
    const total = groupSize(g);
    const cap = g.maxSize > 0 ? `${total}/${g.maxSize}` : `${total}`;
    const leaderId = effectiveLeaderUid(g, grouping.hasLeader);
    lines.push('', `${g.name} (${cap})`);
    const roster: string[] = [
      ...g.memberUids
        .map((uid) => {
          const base = memberNameOf(uid, g);
          const tags: string[] = [];
          if (grouping.shared && g.memberMeta?.[uid]?.tag) tags.push(g.memberMeta[uid].tag);
          if (leaderId && uid === leaderId) tags.push('Leader');
          return { uid, label: tags.length ? `${base} (${tags.join(', ')})` : base };
        })
        .sort((a, b) => {
          if (a.uid === leaderId) return -1;
          if (b.uid === leaderId) return 1;
          return a.label.localeCompare(b.label);
        })
        .map((x) => x.label),
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

// ------------------------------------------------------------------ Stored form

/*
 * How a grouping's groups are stored. The group slots (name and cap) are a list only officers change.
 * Who sits where, join requests, leaders and guests are maps keyed by student, group or guest, so the
 * security rules can check that a student changes only their own entries.
 */
export interface StoredSlot {
  id: string;
  name: string;
  maxSize: number;
}

export interface GroupMaps {
  groups: StoredSlot[];
  /** Student uid to their group and when they took the seat (keeps the join order). */
  seats: Record<string, { g: string; at: number }>;
  /** Shared groupings: each student's name and section, so partner classes can show them. */
  meta: Record<string, MemberMeta>;
  /** Group id to its leader's uid. */
  leaders: Record<string, string>;
  /** Student uid to the group they asked to join. */
  requests: Record<string, { g: string; name: string; classId: string; tag: string; at: number }>;
  /** Guest id to the guest. */
  guests: Record<string, { g: string; name: string; tag: string; by: string; at: number }>;
}

const MAP_KEYS = ['seats', 'meta', 'leaders', 'requests', 'guests'] as const;
export type GroupMapKey = (typeof MAP_KEYS)[number];
export const GROUP_MAP_KEYS: readonly GroupMapKey[] = MAP_KEYS;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** True when a stored grouping still keeps members inside its group list (written before the maps). */
export function isLegacyGrouping(raw: Record<string, unknown>): boolean {
  return !('seats' in raw);
}

/** The groups as the screens use them, from the stored document (either form). */
export function decodeGroups(raw: Record<string, unknown>): GroupSlot[] {
  const list = Array.isArray(raw.groups) ? (raw.groups as Record<string, unknown>[]) : [];
  if (isLegacyGrouping(raw)) {
    return list.map((g) => ({
      ...(g as unknown as GroupSlot),
      id: str(g.id),
      name: str(g.name),
      maxSize: num(g.maxSize),
      memberUids: Array.isArray(g.memberUids) ? (g.memberUids as string[]) : [],
      guests: Array.isArray(g.guests) ? (g.guests as GuestMember[]) : [],
    }));
  }
  const seats = asRecord(raw.seats);
  const meta = asRecord(raw.meta);
  const leaders = asRecord(raw.leaders);
  const requests = asRecord(raw.requests);
  const guests = asRecord(raw.guests);
  const byAt = (a: [string, unknown], b: [string, unknown]) => num(asRecord(a[1]).at) - num(asRecord(b[1]).at) || a[0].localeCompare(b[0]);
  return list.map((slot) => {
    const id = str(slot.id);
    const inSlot = (m: Record<string, unknown>) => Object.entries(m).filter(([, v]) => str(asRecord(v).g) === id).sort(byAt);
    const memberUids = inSlot(seats).map(([uid]) => uid);
    const metaHere = Object.fromEntries(memberUids.filter((u) => u in meta).map((u) => [u, asRecord(meta[u]) as unknown as MemberMeta]));
    const leaderUid = str(leaders[id]);
    const joinRequests: GroupJoinRequest[] = inSlot(requests).map(([uid, v]) => {
      const r = asRecord(v);
      return { uid, name: str(r.name), classId: str(r.classId), tag: str(r.tag), requestedAtMillis: num(r.at) };
    });
    const slotGuests: GuestMember[] = inSlot(guests).map(([gid, v]) => {
      const x = asRecord(v);
      return { id: gid, name: str(x.name), tag: str(x.tag), addedByUid: str(x.by) };
    });
    return {
      id,
      name: str(slot.name),
      maxSize: num(slot.maxSize),
      memberUids,
      ...(Object.keys(metaHere).length > 0 ? { memberMeta: metaHere } : {}),
      ...(leaderUid ? { leaderUid } : {}),
      ...(joinRequests.length > 0 ? { joinRequests } : {}),
      guests: slotGuests,
    };
  });
}

/**
 * The stored form of `groups`. Seats and guests that stay where they were keep their time, so the join
 * order does not change; new ones get `now` (plus their place, to keep several in order).
 */
export function encodeGroups(groups: GroupSlot[], prev: GroupMaps | null, now: number): GroupMaps {
  const out: GroupMaps = { groups: [], seats: {}, meta: {}, leaders: {}, requests: {}, guests: {} };
  let n = 0;
  for (const g of groups) {
    out.groups.push({ id: g.id, name: g.name, maxSize: g.maxSize });
    for (const uid of g.memberUids) {
      const before = prev?.seats[uid];
      out.seats[uid] = { g: g.id, at: before && before.g === g.id ? before.at : now + n++ };
      const m = g.memberMeta?.[uid];
      if (m) out.meta[uid] = { name: m.name, classId: m.classId, tag: m.tag };
    }
    if (g.leaderUid && g.memberUids.includes(g.leaderUid)) out.leaders[g.id] = g.leaderUid;
    for (const r of g.joinRequests ?? []) {
      if (!out.requests[r.uid]) out.requests[r.uid] = { g: g.id, name: r.name, classId: r.classId, tag: r.tag, at: r.requestedAtMillis };
    }
    for (const x of g.guests) {
      const before = prev?.guests[x.id];
      out.guests[x.id] = { g: g.id, name: x.name, tag: x.tag, by: x.addedByUid, at: before && before.g === g.id ? before.at : now + n++ };
    }
  }
  return out;
}

/** The stored maps of a document in the new form (empty ones for a legacy document). */
export function storedMaps(raw: Record<string, unknown>): GroupMaps {
  const pick = <T,>(k: string) => asRecord(raw[k]) as T;
  return {
    groups: (Array.isArray(raw.groups) ? (raw.groups as Record<string, unknown>[]) : []).map((g) => ({ id: str(g.id), name: str(g.name), maxSize: num(g.maxSize) })),
    seats: pick('seats'),
    meta: pick('meta'),
    leaders: pick('leaders'),
    requests: pick('requests'),
    guests: pick('guests'),
  };
}

/** Each map entry that differs between two stored forms: [map, key, new value or undefined when removed]. */
export function changedEntries(before: GroupMaps, after: GroupMaps): [GroupMapKey, string, unknown][] {
  const out: [GroupMapKey, string, unknown][] = [];
  for (const k of MAP_KEYS) {
    const a = before[k] as Record<string, unknown>;
    const b = after[k] as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in b)) out.push([k, key, undefined]);
      else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push([k, key, b[key]]);
    }
  }
  return out;
}

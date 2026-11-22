import { describe, expect, it } from 'vitest';
import {
  approveGroupJoinRequest,
  changedEntries,
  decodeGroups,
  encodeGroups,
  isLegacyGrouping,
  moveMemberToGroup,
  removeMemberFromGroups,
  requestToJoinGroup,
  storedMaps,
  type GroupSlot,
} from './groupingLogic';

const slots = (): GroupSlot[] => [
  { id: 'g1', name: 'Group 1', maxSize: 3, memberUids: [], guests: [] },
  { id: 'g2', name: 'Group 2', maxSize: 3, memberUids: [], guests: [] },
];

/** Stores groups and reads them back, as the app does. */
const roundTrip = (groups: GroupSlot[], now = 100) => {
  const maps = encodeGroups(groups, null, now);
  return { maps, groups: decodeGroups({ ...maps } as Record<string, unknown>) };
};

describe('stored groupings', () => {
  it('reads back the same members, leaders, requests and guests', () => {
    let g = moveMemberToGroup(slots(), 'ben', 'g1', false, { name: 'Ben', classId: 'c2', tag: 'G2' });
    g = moveMemberToGroup(g, 'ann', 'g1');
    g = requestToJoinGroup(g, 'g2', { uid: 'cat', name: 'Cat', classId: 'c1', tag: '', requestedAtMillis: 5 });
    g = g.map((s) => (s.id === 'g1' ? { ...s, guests: [{ id: 'x1', name: 'Irregular', tag: 'G3', addedByUid: 'ann' }] } : s));
    const back = roundTrip(g).groups;
    expect(back[0].memberUids).toEqual(['ben', 'ann']);
    expect(back[0].leaderUid).toBe('ben');
    expect(back[0].memberMeta).toEqual({ ben: { name: 'Ben', classId: 'c2', tag: 'G2' } });
    expect(back[0].guests).toEqual([{ id: 'x1', name: 'Irregular', tag: 'G3', addedByUid: 'ann' }]);
    expect(back[1].joinRequests).toEqual([{ uid: 'cat', name: 'Cat', classId: 'c1', tag: '', requestedAtMillis: 5 }]);
    expect(back[1].memberUids).toEqual([]);
  });

  it('keeps the join order when someone else changes groups later', () => {
    const first = encodeGroups(moveMemberToGroup(moveMemberToGroup(slots(), 'ben', 'g1'), 'ann', 'g1'), null, 100);
    const decoded = decodeGroups({ ...first } as Record<string, unknown>);
    const later = encodeGroups(moveMemberToGroup(decoded, 'cat', 'g1'), first, 500);
    expect(later.seats.ben.at).toBe(first.seats.ben.at);
    expect(decodeGroups({ ...later } as Record<string, unknown>)[0].memberUids).toEqual(['ben', 'ann', 'cat']);
  });

  it('a student joining touches only their own seat, plus the lead of an empty group', () => {
    const before = encodeGroups(moveMemberToGroup(slots(), 'ben', 'g1'), null, 100);
    const decoded = decodeGroups({ ...before } as Record<string, unknown>);
    const after = encodeGroups(moveMemberToGroup(decoded, 'ann', 'g2'), before, 200);
    expect(changedEntries(before, after).map(([m, k]) => `${m}.${k}`).sort()).toEqual(['leaders.g2', 'seats.ann']);
  });

  it('a leader approving touches only the entries of the requester', () => {
    let g = moveMemberToGroup(slots(), 'ben', 'g1');
    g = requestToJoinGroup(g, 'g1', { uid: 'cat', name: 'Cat', classId: 'c1', tag: '', requestedAtMillis: 5 });
    const before = encodeGroups(g, null, 100);
    const after = encodeGroups(approveGroupJoinRequest(decodeGroups({ ...before } as Record<string, unknown>), 'g1', 'cat'), before, 200);
    expect(changedEntries(before, after).map(([m, k]) => `${m}.${k}`).sort()).toEqual(['meta.cat', 'requests.cat', 'seats.cat']);
  });

  it('a leader leaving hands the lead to the next member', () => {
    const before = encodeGroups(moveMemberToGroup(moveMemberToGroup(slots(), 'ben', 'g1'), 'ann', 'g1'), null, 100);
    const after = encodeGroups(removeMemberFromGroups(decodeGroups({ ...before } as Record<string, unknown>), 'ben'), before, 200);
    expect(after.leaders).toEqual({ g1: 'ann' });
    expect(changedEntries(before, after).map(([m, k, v]) => `${m}.${k}=${v === undefined ? 'gone' : 'set'}`).sort()).toEqual(['leaders.g1=set', 'seats.ben=gone']);
  });

  it('still reads groupings saved before the maps', () => {
    const legacy = { groups: [{ id: 'g1', name: 'G', maxSize: 2, memberUids: ['ben'], guests: [], leaderUid: 'ben' }] };
    expect(isLegacyGrouping(legacy)).toBe(true);
    expect(decodeGroups(legacy)[0].memberUids).toEqual(['ben']);
    expect(storedMaps(legacy).seats).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import {
  addGuestToGroup,
  classTagLabel,
  approveGroupJoinRequest,
  autoAssignMembers,
  buildInitialGroups,
  effectiveLeaderUid,
  findMemberGroup,
  formatGroupingExport,
  groupRemaining,
  groupSize,
  isGroupFull,
  moveMemberToGroup,
  newGrouping,
  passGroupLeadership,
  removeGroupJoinRequest,
  removeGuestFromGroup,
  removeMemberFromGroups,
  requestToJoinGroup,
  ungroupedMemberIds,
} from './groupingLogic';

describe('groupingLogic', () => {
  it('supports uneven per-group capacities (e.g. 42 students split into 11, 11, 10, 10)', () => {
    const groups = buildInitialGroups(4, 10, (i) => `g${i + 1}`, [11, 11, 10, 10]);
    expect(groups.map((g) => g.maxSize)).toEqual([11, 11, 10, 10]);
    const all42 = Array.from({ length: 42 }, (_, i) => `u${i + 1}`);
    const { groups: filled, assigned } = autoAssignMembers(groups, all42);
    expect(assigned).toBe(42);
    expect(filled.map((g) => groupSize(g))).toEqual([11, 11, 10, 10]);
    expect(filled.every((g) => isGroupFull(g))).toBe(true);
    expect(ungroupedMemberIds(filled, all42)).toEqual([]);
  });

  it('counts guest teammates toward group capacity without affecting ungrouped ClassHub members', () => {
    let groups = buildInitialGroups(2, 2, (i) => `g${i + 1}`);
    groups = moveMemberToGroup(groups, 'u1', 'g1');
    groups = addGuestToGroup(groups, 'g1', { id: 'x1', name: 'Maria Santos', tag: 'G2', addedByUid: 'u1' });

    expect(groupSize(groups[0])).toBe(2);
    expect(isGroupFull(groups[0])).toBe(true);
    expect(groupRemaining(groups[0])).toBe(0);
    expect(() => moveMemberToGroup(groups, 'u2', 'g1')).toThrow(/already full/i);

    expect(ungroupedMemberIds(groups, ['u1', 'u2'])).toEqual(['u2']);

    groups = removeGuestFromGroup(groups, 'g1', 'x1');
    expect(isGroupFull(groups[0])).toBe(false);
    expect(groupRemaining(groups[0])).toBe(1);
  });

  it('moves a student cleanly when switching groups and preserves memberMeta', () => {
    let groups = buildInitialGroups(2, 0, (i) => `g${i + 1}`);
    groups = moveMemberToGroup(groups, 'u1', 'g1', false, { name: 'Alex Reyes', classId: 'c1', tag: 'G1' });
    expect(findMemberGroup(groups, 'u1')?.id).toBe('g1');
    expect(groups[0].memberMeta?.u1?.tag).toBe('G1');

    groups = moveMemberToGroup(groups, 'u1', 'g2');
    expect(findMemberGroup(groups, 'u1')?.id).toBe('g2');
    expect(groups[0].memberUids).toEqual([]);
    expect(groups[0].memberMeta?.u1).toBeUndefined();
    expect(groups[1].memberUids).toEqual(['u1']);
    expect(groups[1].memberMeta?.u1?.tag).toBe('G1');

    groups = removeMemberFromGroups(groups, 'u1');
    expect(findMemberGroup(groups, 'u1')).toBeUndefined();
    expect(groups[1].memberMeta?.u1).toBeUndefined();
  });

  it('rejects duplicate guest names in the same group (case-insensitive)', () => {
    let groups = buildInitialGroups(1, 5, () => 'g1');
    groups = addGuestToGroup(groups, 'g1', { id: 'x1', name: 'Juan Cruz', tag: 'Irregular', addedByUid: 'u1' });
    expect(() =>
      addGuestToGroup(groups, 'g1', { id: 'x2', name: '  juan cruz  ', tag: 'G2', addedByUid: 'u1' }),
    ).toThrow(/already listed/i);
  });

  it('formats plain-text export with cross-class tags (G1/G2) and tagged guests', () => {
    let groups = buildInitialGroups(2, 11, (i) => `g${i + 1}`, [11, 10]);
    groups = moveMemberToGroup(groups, 'u1', 'g1', false, { name: 'Alex Reyes', classId: 'c1', tag: 'G1' });
    groups = moveMemberToGroup(groups, 'u2', 'g1', false, { name: 'Maria Santos', classId: 'c2', tag: 'G2' });
    groups = addGuestToGroup(groups, 'g1', { id: 'x1', name: 'Juan Cruz', tag: 'Irregular', addedByUid: 'u1' });

    const grouping = newGrouping({
      id: 'grp1',
      title: 'The Entrepreneurial Mind',
      note: 'Combined G1 + G2',
      shared: true,
      groups,
    });
    const text = formatGroupingExport(grouping, 'Entrepreneurial Mind', (uid, slot) => slot.memberMeta?.[uid]?.name ?? uid);
    expect(text).toContain('The Entrepreneurial Mind (Entrepreneurial Mind)');
    expect(text).toContain('Group 1 (3/11)');
    expect(text).toContain('  1. Alex Reyes (G1)');
    expect(text).toContain('  2. Maria Santos (G2)');
    expect(text).toContain('  3. Juan Cruz (Irregular)');
    expect(text).toContain('Group 2 (0/10)');
    expect(text).toContain('  (No members yet)');
  });

  it('auto-assigns first member as leader, allows passing leadership, and promotes next member on leave', () => {
    let groups = buildInitialGroups(2, 5, (i) => `g${i + 1}`);
    groups = moveMemberToGroup(groups, 'u1', 'g1');
    groups = moveMemberToGroup(groups, 'u2', 'g1');
    expect(effectiveLeaderUid(groups[0], true)).toBe('u1');
    expect(effectiveLeaderUid(groups[0], false)).toBe('');

    groups = passGroupLeadership(groups, 'g1', 'u2');
    expect(effectiveLeaderUid(groups[0], true)).toBe('u2');

    // Leaving passes leadership to the remaining member
    groups = removeMemberFromGroups(groups, 'u2');
    expect(effectiveLeaderUid(groups[0], true)).toBe('u1');

    const grouping = newGrouping({ id: 'grp', title: 'Lab', hasLeader: true, groups });
    const exported = formatGroupingExport(grouping, '', (uid) => (uid === 'u1' ? 'Alex' : uid));
    expect(exported).toContain('1. Alex (Leader)');
  });

  it('handles leader approval and rejection of join requests', () => {
    let groups = buildInitialGroups(2, 2, (i) => `g${i + 1}`);
    groups = moveMemberToGroup(groups, 'u1', 'g1');
    groups = requestToJoinGroup(groups, 'g1', { uid: 'u2', name: 'Bea', classId: 'c1', tag: 'G1', requestedAtMillis: 100 });
    groups = requestToJoinGroup(groups, 'g2', { uid: 'u2', name: 'Bea', classId: 'c1', tag: 'G1', requestedAtMillis: 101 });
    expect(groups[0].joinRequests?.map((r) => r.uid)).toEqual(['u2']);

    // Approve in g1 moves u2 in and clears their pending request in g2 as well
    groups = approveGroupJoinRequest(groups, 'g1', 'u2');
    expect(groups[0].memberUids).toEqual(['u1', 'u2']);
    expect(groups[0].joinRequests).toEqual([]);
    expect(groups[1].joinRequests).toEqual([]);

    // Reject removes request without adding member
    groups = requestToJoinGroup(groups, 'g2', { uid: 'u3', name: 'Carl', classId: 'c2', tag: 'G2', requestedAtMillis: 102 });
    groups = removeGroupJoinRequest(groups, 'g2', 'u3');
    expect(groups[1].joinRequests).toEqual([]);
    expect(groups[1].memberUids).toEqual([]);
  });
});

describe('classTagLabel', () => {
  it('adds the section tag only when the class name does not already show it', () => {
    expect(classTagLabel('BSIT 3A', 'G1')).toBe('BSIT 3A (G1)');
    expect(classTagLabel('BSM CS 3A (G2)', 'G2')).toBe('BSM CS 3A (G2)');
    expect(classTagLabel('BSM CS 3A-G1', 'g1')).toBe('BSM CS 3A-G1');
    expect(classTagLabel('BSIT 3G1X', 'G1')).toBe('BSIT 3G1X (G1)');
    expect(classTagLabel('BSIT 3A', ' ')).toBe('BSIT 3A');
    expect(classTagLabel('Lab (A+)', 'A+')).toBe('Lab (A+)');
  });
});

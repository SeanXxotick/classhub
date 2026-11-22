import { describe, expect, it } from 'vitest';
import {
  addGuestToGroup,
  autoAssignMembers,
  buildInitialGroups,
  findMemberGroup,
  formatGroupingExport,
  groupRemaining,
  groupSize,
  isGroupFull,
  moveMemberToGroup,
  newGrouping,
  removeGuestFromGroup,
  removeMemberFromGroups,
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

    // u2 is still ungrouped in this class; guest Maria is not in eligibleUids
    expect(ungroupedMemberIds(groups, ['u1', 'u2'])).toEqual(['u2']);

    // Removing the guest frees the slot
    groups = removeGuestFromGroup(groups, 'g1', 'x1');
    expect(isGroupFull(groups[0])).toBe(false);
    expect(groupRemaining(groups[0])).toBe(1);
  });

  it('moves a student cleanly when switching groups and supports leaving', () => {
    let groups = buildInitialGroups(2, 0, (i) => `g${i + 1}`);
    groups = moveMemberToGroup(groups, 'u1', 'g1');
    expect(findMemberGroup(groups, 'u1')?.id).toBe('g1');

    groups = moveMemberToGroup(groups, 'u1', 'g2');
    expect(findMemberGroup(groups, 'u1')?.id).toBe('g2');
    expect(groups[0].memberUids).toEqual([]);
    expect(groups[1].memberUids).toEqual(['u1']);

    groups = removeMemberFromGroups(groups, 'u1');
    expect(findMemberGroup(groups, 'u1')).toBeUndefined();
  });

  it('rejects duplicate guest names in the same group (case-insensitive)', () => {
    let groups = buildInitialGroups(1, 5, () => 'g1');
    groups = addGuestToGroup(groups, 'g1', { id: 'x1', name: 'Juan Cruz', tag: 'Irregular', addedByUid: 'u1' });
    expect(() =>
      addGuestToGroup(groups, 'g1', { id: 'x2', name: '  juan cruz  ', tag: 'G2', addedByUid: 'u1' }),
    ).toThrow(/already listed/i);
  });

  it('formats plain-text export with both ClassHub members and tagged guests', () => {
    const groups = buildInitialGroups(2, 11, (i) => `g${i + 1}`, [11, 10]);
    const filled = addGuestToGroup(
      moveMemberToGroup(moveMemberToGroup(groups, 'u2', 'g1'), 'u1', 'g1'),
      'g1',
      { id: 'x1', name: 'Maria Santos', tag: 'G2', addedByUid: 'u1' },
    );
    const grouping = newGrouping({
      id: 'grp1',
      title: 'Final Project Teams',
      note: 'Combined G1 + G2',
      groups: filled,
    });
    const names: Record<string, string> = { u1: 'Alex Reyes', u2: 'Bea Lim' };
    const text = formatGroupingExport(grouping, 'SWE FCO', (uid) => names[uid] ?? uid);
    expect(text).toContain('Final Project Teams (SWE FCO)');
    expect(text).toContain('Combined G1 + G2');
    expect(text).toContain('Group 1 (3/11)');
    expect(text).toContain('  1. Alex Reyes');
    expect(text).toContain('  2. Bea Lim');
    expect(text).toContain('  3. Maria Santos (G2)');
    expect(text).toContain('Group 2 (0/10)');
    expect(text).toContain('  (No members yet)');
  });
});

import { describe, expect, it } from 'vitest';
import { newRole } from '../data/models';
import { DefaultRoles, canSeeAllBalances, isOfficer } from './permissions';

const [mayor, treasurer, secretary, member] = DefaultRoles.all();

describe('officers', () => {
  it('are roles with at least one permission', () => {
    expect([mayor, treasurer, secretary].every(isOfficer)).toBe(true);
    expect(isOfficer(member)).toBe(false);
    expect(isOfficer(null)).toBe(false);
    expect(isOfficer(newRole({ permissions: ['CONTENTS_MANAGE'] }))).toBe(true);
  });
  it('Secretary can post announcements by default', () => {
    expect(secretary.permissions).toContain('ANNOUNCEMENTS_MANAGE');
  });
});

describe('who sees every balance', () => {
  it('the Mayor and record managers always do', () => {
    for (const v of ['EVERYONE', 'OFFICERS', 'TREASURERS'] as const) {
      expect(canSeeAllBalances(mayor, v)).toBe(true);
      expect(canSeeAllBalances(treasurer, v)).toBe(true);
    }
  });
  it('EVERYONE lets plain members see', () => {
    expect(canSeeAllBalances(member, 'EVERYONE')).toBe(true);
  });
  it('OFFICERS lets the Secretary see but not a plain member', () => {
    expect(canSeeAllBalances(secretary, 'OFFICERS')).toBe(true);
    expect(canSeeAllBalances(member, 'OFFICERS')).toBe(false);
  });
  it('TREASURERS keeps the Secretary and members out', () => {
    expect(canSeeAllBalances(secretary, 'TREASURERS')).toBe(false);
    expect(canSeeAllBalances(member, 'TREASURERS')).toBe(false);
  });
  it('a non-member sees nothing', () => {
    expect(canSeeAllBalances(null, 'EVERYONE')).toBe(false);
  });
});

import {
  PERMISSIONS,
  type BalanceVisibility,
  ROLE_MAYOR,
  ROLE_MEMBER,
  ROLE_SECRETARY,
  ROLE_TREASURER,
  newRole,
  type Permission,
  type Role,
} from '../data/models';

/**
 * True when this role grants the permission. A missing role (not a member) grants nothing.
 * The locked Mayor role always has every permission, including ones added in later app versions.
 */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && (role.locked || role.permissions.includes(permission));
}

/** The roles every new class starts with. The Mayor can add, change and delete the others. */
export const DefaultRoles = {
  all(): Role[] {
    return [
      newRole({ id: ROLE_MAYOR, name: 'Mayor', colorHex: '#7C3AED', permissions: [...PERMISSIONS], locked: true }),
      newRole({ id: ROLE_TREASURER, name: 'Treasurer', colorHex: '#15803D', permissions: ['RECORDS_MANAGE'] }),
      newRole({ id: ROLE_SECRETARY, name: 'Secretary', colorHex: '#3730A3', permissions: ['SCHEDULE_MANAGE', 'CONTENTS_MANAGE', 'ANNOUNCEMENTS_MANAGE'] }),
      newRole({ id: ROLE_MEMBER, name: 'Member', colorHex: '#6B768A', permissions: [] }),
    ];
  },
};

export const RoleRules = {
  /** Locked roles (the Mayor) cannot be edited. */
  canEdit(role: Role): boolean {
    return !role.locked;
  },

  /** Locked roles and the class's default role cannot be deleted, since new members land in the default role. */
  canDelete(role: Role, defaultRoleId: string): boolean {
    return !role.locked && role.id !== defaultRoleId;
  },

  /** A role name must be non-blank and not already used by another role (ignoring case). */
  isNameValid(name: string, existing: Role[], editingId = ''): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 24) return false;
    return !existing.some((r) => r.id !== editingId && r.name.toLowerCase() === trimmed.toLowerCase());
  },

  /** Only known permission names are kept, and duplicates are dropped. */
  sanitize(permissions: Iterable<string>): string[] {
    const known = new Set<string>(PERMISSIONS);
    return [...new Set([...permissions].filter((p) => known.has(p)))];
  },
};

/** An officer is anyone whose role switches on at least one permission. Plain members are not officers. */
export function isOfficer(role: Role | null | undefined): boolean {
  return !!role && (role.locked || role.permissions.length > 0);
}

/**
 * Whether this person may read every member's records and balances.
 * The Mayor and anyone who manages records always can; otherwise the class setting decides.
 * Everyone else still reads their own records and the fund totals.
 */
export function canSeeAllBalances(role: Role | null | undefined, visibility: BalanceVisibility): boolean {
  if (!role) return false;
  if (role.locked || can(role, 'RECORDS_MANAGE')) return true;
  return visibility === 'EVERYONE' || (visibility === 'OFFICERS' && isOfficer(role));
}

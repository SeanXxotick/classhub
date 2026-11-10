/*
 * The Firestore documents, field for field as the Android app (data/model/Models.kt) reads and writes them.
 * Both apps share the same database, so a field name changed here breaks the other app.
 */

/** Ids of the roles every new class starts with. */
export const ROLE_MAYOR = 'mayor';
export const ROLE_TREASURER = 'treasurer';
export const ROLE_SECRETARY = 'secretary';
export const ROLE_MEMBER = 'member';

/** What a role can be allowed to do. Everyone in a class can always view its content. */
export const PERMISSIONS = [
  'RECORDS_MANAGE',
  'SCHEDULE_MANAGE',
  'MEMBERS_MANAGE',
  'ROLES_MANAGE',
  'CLASS_SETTINGS',
  'CONTENTS_MANAGE',
  'ANNOUNCEMENTS_MANAGE',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What a class content link points to. Only links are stored; files stay in Google Drive or elsewhere. */
export const CONTENT_KINDS = ['FILE', 'VIDEO', 'WEBSITE'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/**
 * PAYMENT    a member pays money in (member balance +, cash +)
 * CHARGE     a per-member deduction such as a quiz fee (member balance -, cash unchanged)
 * WITHDRAWAL a member takes part of their balance out (member balance -, cash -)
 * EXPENSE    the class pays for something, no member involved (cash -)
 * OPENING    a balance carried in from before the class used ClassHub (member balance and cash, both by the signed amount)
 *
 * On screen these read "Payment", "Charge students", "Withdrawal" and "Pay out from fund".
 */
export const RECORD_TYPES = ['PAYMENT', 'CHARGE', 'WITHDRAWAL', 'EXPENSE', 'OPENING'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const SCHEDULE_KINDS = ['DEADLINE', 'QUIZ', 'EXAM', 'RECITATION', 'FCO'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Who may see every member's balance. */
export const BALANCE_VISIBILITIES = ['EVERYONE', 'OFFICERS', 'TREASURERS'] as const;
export type BalanceVisibility = (typeof BALANCE_VISIBILITIES)[number];

export type ScheduleStatus = 'PENDING' | 'SUBMITTED' | 'CANCELLED';

/** Firestore: users/{uid} */
export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  /** The parts of displayName, once the student has edited their name. Empty for older accounts. */
  firstName: string;
  middleInitial: string;
  lastName: string;
  /** Set for accounts the class created with a temporary password; cleared once the user picks their own. */
  mustChangePassword: boolean;
}

/** Firestore: users/{uid}/memberships/{classId}. The "My classes" list. */
export interface ClassMembership {
  classId: string;
  className: string;
  joinedAtMillis: number;
}

/** Firestore: classes/{classId} */
export interface ClassRoom {
  id: string;
  name: string;
  description: string;
  ownerUid: string;
  accentColor: string;
  inviteCode: string;
  defaultRoleId: string;
  ledgerEnabled: boolean;
  scheduleEnabled: boolean;
  contentsEnabled: boolean;
  announcementsEnabled: boolean;
  timetableEnabled: boolean;
  /** Who may see other students' balances. The Mayor and people who manage records always can. */
  balanceVisibility: BalanceVisibility;
  /** Where students send money (for example a GCash number), shown next to the I paid button. */
  paymentInfo: string;
  /** 0 while the class is active. An archived class is read-only. */
  archivedAtMillis: number;
  /** The class that continued this one the next semester, or empty. */
  carriedOverTo: string;
  /** Icon chosen per schedule type (type name to icon key); types not listed use the default icon. */
  scheduleIcons: Record<string, string>;
  /** Color chosen per schedule type (type name to #RRGGBB); others use the default color. */
  scheduleColors: Record<string, string>;
  /** Icon and color chosen per contents type (FILE, VIDEO, WEBSITE). */
  contentIcons: Record<string, string>;
  contentColors: Record<string, string>;
  createdAtMillis: number;
}

/** Firestore: classes/{classId}/roles/{roleId}. A locked role (the Mayor) cannot be edited or deleted. */
export interface Role {
  id: string;
  name: string;
  colorHex: string;
  permissions: string[];
  locked: boolean;
}

/**
 * Firestore: classes/{classId}/members/{uid}
 * excludedCourseIds lists the courses this member does NOT take.
 */
export interface Member {
  id: string;
  /** The account's uid, repeated inside the document so one query can find every class a person is in. */
  uid: string;
  name: string;
  roleId: string;
  joinedAtMillis: number;
  excludedCourseIds: string[];
  approvedByUid: string;
}

/** Firestore: classes/{classId}/joinRequests/{uid}. A student who used the code and waits for an officer. */
export interface JoinRequest {
  id: string;
  uid: string;
  name: string;
  joinCode: string;
  requestedAtMillis: number;
}

/** Firestore: classes/{classId}/courses/{id}. A subject the class takes. */
export interface Course {
  id: string;
  name: string;
}

/**
 * Firestore: classes/{classId}/records/{id}
 * Money is stored as whole centavos so balances never drift. memberId is empty for an EXPENSE.
 * A charge to many members is one record per member sharing a batchId. Every EXPENSE (pay-out)
 * settles exactly one charge: settlesBatchId is that charge's batch id.
 */
export interface LedgerRecord {
  id: string;
  type: RecordType;
  amountCentavos: number;
  memberId: string;
  memberName: string;
  note: string;
  dateMillis: number;
  batchId: string;
  courseId: string;
  createdByUid: string;
  settlesBatchId: string;
  paidTo: string;
  /** The payment claim this PAYMENT confirms, if any. */
  claimId: string;
  createdAtMillis: number;
  /** Records are never deleted. A voided record stays in the history and counts toward nothing. 0 = not voided. */
  voidedAtMillis: number;
  voidedByUid: string;
  voidReason: string;
}

/** Firestore: classes/{classId}/contents/{id}. courseId is empty for general class material. */
export interface ContentItem {
  id: string;
  courseId: string;
  title: string;
  url: string;
  kind: ContentKind;
  note: string;
  createdByUid: string;
  createdAtMillis: number;
}

/**
 * Firestore: classes/{classId}/schedule/{id}. dueMillis is local noon on the due day.
 * status is class-wide: PENDING (active) or CANCELLED. Whether a student finished it lives in StudentProgress.
 */
export interface ScheduleItem {
  id: string;
  courseId: string;
  title: string;
  kind: ScheduleKind;
  dueMillis: number;
  status: ScheduleStatus;
  note: string;
  createdByUid: string;
}

/** Firestore: classes/{classId}/progress/{uid}. The schedule items one student marked done, with when. */
export interface StudentProgress {
  id: string;
  done: Record<string, number>;
}

/* Constructors with the same defaults as the Kotlin data classes. */

export const newRecord = (r: Partial<LedgerRecord>): LedgerRecord => ({
  id: '', type: 'PAYMENT', amountCentavos: 0, memberId: '', memberName: '', note: '', dateMillis: 0,
  batchId: '', courseId: '', createdByUid: '', settlesBatchId: '', paidTo: '', claimId: '', createdAtMillis: 0,
  voidedAtMillis: 0, voidedByUid: '', voidReason: '', ...r,
});

export const newMember = (m: Partial<Member>): Member => ({
  id: '', uid: '', name: '', roleId: ROLE_MEMBER, joinedAtMillis: 0, excludedCourseIds: [], approvedByUid: '', ...m,
});

export const newRole = (r: Partial<Role>): Role => ({
  id: '', name: '', colorHex: '#6B768A', permissions: [], locked: false, ...r,
});

export const newScheduleItem = (s: Partial<ScheduleItem>): ScheduleItem => ({
  id: '', courseId: '', title: '', kind: 'DEADLINE', dueMillis: 0, status: 'PENDING', note: '', createdByUid: '', ...s,
});

export const newContentItem = (c: Partial<ContentItem>): ContentItem => ({
  id: '', courseId: '', title: '', url: '', kind: 'WEBSITE', note: '', createdByUid: '', createdAtMillis: 0, ...c,
});

export const newClassRoom = (c: Partial<ClassRoom>): ClassRoom => ({
  id: '', name: '', description: '', ownerUid: '', accentColor: '#0F766E', inviteCode: '', defaultRoleId: ROLE_MEMBER,
  ledgerEnabled: true, scheduleEnabled: true, contentsEnabled: true, announcementsEnabled: true, timetableEnabled: true,
  balanceVisibility: 'EVERYONE', paymentInfo: '', archivedAtMillis: 0, carriedOverTo: '', scheduleIcons: {}, scheduleColors: {},
  contentIcons: {}, contentColors: {}, createdAtMillis: 0, ...c,
});

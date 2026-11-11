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
  'ATTENDANCE_MANAGE',
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
  /** Icon chosen per schedule type (type name to icon key); types not listed use the default icon. */
  scheduleIcons: Record<string, string>;
  /** Color chosen per schedule type (type name to #RRGGBB); others use the default color. */
  scheduleColors: Record<string, string>;
  /** Icon and color chosen per contents type (FILE, VIDEO, WEBSITE). */
  contentIcons: Record<string, string>;
  contentColors: Record<string, string>;
  /**
   * 0 normally. The Mayor sets it as the first step of deleting the class; from then on the books are closed
   * and it is never cleared. A class left with a value here is finished by the Mayor's app the next time it opens.
   */
  deletingAtMillis: number;
  createdAtMillis: number;
}

/** Firestore: invites/{code}. Only the class id and name: someone holding the code cannot read the class yet. */
export interface Invite {
  /** The invite code (the document id). */
  code: string;
  classId: string;
  className: string;
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
  /** "Garcia, Paolo M.": the name in lists sorted by last name. Set by the member's own app; empty until then. */
  sortName?: string;
}

/** A member's name in a list sorted by last name. Falls back to the display name. */
export const listName = (m: { name: string; sortName?: string }): string => m.sortName || m.name;

/** Members in last-name order (those without a last-name form sort by their display name). */
export const byLastName = <T extends { name: string; sortName?: string }>(members: T[]): T[] =>
  [...members].sort((a, b) => listName(a).localeCompare(listName(b), 'en', { sensitivity: 'base' }));

/** "Garcia, Paolo M." from the profile's name parts; empty when there is no last name. */
export function sortNameOf(first: string, middleInitial: string, last: string): string {
  const mi = middleInitial.trim().replace(/\.$/, '');
  if (!last.trim() || !first.trim()) return '';
  return `${last.trim()}, ${first.trim()}${mi ? ` ${mi}.` : ''}`.slice(0, 100);
}

/** Firestore: classes/{classId}/joinRequests/{uid}. A student who used the code and waits for an officer. */
export interface JoinRequest {
  id: string;
  uid: string;
  name: string;
  /** Copied from the invite, because someone who is still waiting cannot read the class itself. */
  className: string;
  joinCode: string;
  requestedAtMillis: number;
}

/** Firestore: classes/{classId}/courses/{id}. A subject the class takes. */
export interface Course {
  id: string;
  name: string;
  /** Hex colour of the course in the timetable. Empty: the class accent. */
  color?: string;
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

/**
 * Firestore: classes/{classId}/charges/{batchId}. One per charge, written in the same batch as its CHARGE shares.
 * It carries no names, so every member may read it. perMemberCentavos is 0 when the students were charged
 * different amounts. payoutRecordId names the one standing pay-out (empty until paid out, cleared when that
 * pay-out is voided).
 */
export interface Charge {
  /** The batch id shared by the charge's CHARGE records (the document id). */
  id: string;
  note: string;
  courseId: string;
  dateMillis: number;
  count: number;
  totalCentavos: number;
  perMemberCentavos: number;
  payoutRecordId: string;
  voidedAtMillis: number;
  voidedByUid: string;
  voidReason: string;
  createdByUid: string;
  createdAtMillis: number;
}

/**
 * Firestore: classes/{classId}/summary/fund. The fund totals every member may read, kept with increments in the
 * same batch as each record write and rewritten whole when a records manager's app repairs it.
 */
export interface StoredFundSummary {
  cashOnHandCentavos: number;
  waitingPayoutCentavos: number;
  balancesTotalCentavos: number;
  recordCount: number;
  updatedAtMillis: number;
}

/**
 * Firestore: classes/{classId}/openingBalances/{uid}. A balance waiting for its student to be in the class.
 * A records manager's app turns it into the OPENING record opening-{uid} and deletes it in one batch.
 */
export interface PendingOpeningBalance {
  /** The student's uid (the document id). */
  id: string;
  /** Signed: negative when the student owed the class. Never 0. */
  amountCentavos: number;
  note: string;
}

/** Firestore: clientErrors/{id}. Create only; nobody reads them from the app. */
export interface ClientErrorReport {
  message: string;
  stack: string;
  appVersion: string;
  platform: string;
  atMillis: number;
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
  /** This item's own icon and color. Empty: it follows its type (and the class's choice for the type). */
  icon: string;
  color: string;
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
  id: '', courseId: '', title: '', url: '', kind: 'WEBSITE', note: '', createdByUid: '', createdAtMillis: 0, icon: '', color: '', ...c,
});

export const newClassRoom = (c: Partial<ClassRoom>): ClassRoom => ({
  id: '', name: '', description: '', ownerUid: '', accentColor: '#0F766E', inviteCode: '', defaultRoleId: ROLE_MEMBER,
  ledgerEnabled: true, scheduleEnabled: true, contentsEnabled: true, announcementsEnabled: true, timetableEnabled: true,
  balanceVisibility: 'EVERYONE', paymentInfo: '', scheduleIcons: {}, scheduleColors: {},
  contentIcons: {}, contentColors: {}, deletingAtMillis: 0, createdAtMillis: 0, ...c,
});

export const newInvite = (i: Partial<Invite>): Invite => ({ code: '', classId: '', className: '', ...i });

export const newJoinRequest = (r: Partial<JoinRequest>): JoinRequest => ({
  id: '', uid: '', name: '', className: '', joinCode: '', requestedAtMillis: 0, ...r,
});

export const newCourse = (c: Partial<Course>): Course => ({ id: '', name: '', color: '', ...c });

export const newCharge = (c: Partial<Charge>): Charge => ({
  id: '', note: '', courseId: '', dateMillis: 0, count: 0, totalCentavos: 0, perMemberCentavos: 0, payoutRecordId: '',
  voidedAtMillis: 0, voidedByUid: '', voidReason: '', createdByUid: '', createdAtMillis: 0, ...c,
});

export const newStoredFundSummary = (s: Partial<StoredFundSummary>): StoredFundSummary => ({
  cashOnHandCentavos: 0, waitingPayoutCentavos: 0, balancesTotalCentavos: 0, recordCount: 0, updatedAtMillis: 0, ...s,
});

export const newPendingOpeningBalance = (o: Partial<PendingOpeningBalance>): PendingOpeningBalance => ({
  id: '', amountCentavos: 0, note: '', ...o,
});

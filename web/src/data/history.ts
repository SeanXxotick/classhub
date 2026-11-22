import { collection, doc, limit, orderBy, query, where, writeBatch, type DocumentSnapshot, type Firestore, type QueryConstraint, type WriteBatch } from 'firebase/firestore';
import { formatMoney } from '../domain/money';
import { newId, nowMillis } from './dataEnv';
import { useQueryList } from './live';
import { memberRef, readFast } from './paths';

/*
 * The history log: classes/{classId}/history/{id}, one entry per officer action on money, people, settings,
 * attendance, the schedule and timetable, contents, announcements, comments and the Forum, plus members who
 * leave on their own (docs/HISTORY-PLAN.md). Each entry is written in the same batch
 * as the action, so an action and its entry are saved together or not at all. The rules make the log
 * append-only (nobody edits or deletes an entry; they go with the class) and only let people with
 * CLASS_SETTINGS read it.
 */

export const HISTORY_KINDS = [
  'PAYMENT', 'WITHDRAWAL', 'OPENING', 'OPENING_PENDING', 'CHARGE', 'PAYOUT', 'VOID', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'LEDGER_SETTINGS',
  'JOIN_APPROVED', 'JOIN_REJECTED', 'MEMBER_REMOVED', 'MEMBER_ROLE', 'MEMBER_COURSES', 'ROLE_SAVED', 'ROLE_DELETED', 'MAYOR_HANDOVER', 'INVITE_CODE',
  'CLASS_SETTINGS', 'CLASS_PHOTO', 'REMINDERS', 'ANNOUNCEMENT_EDITED', 'ANNOUNCEMENT_DELETED',
  // Nov 22
  'ATTENDANCE_TAKEN', 'ATTENDANCE_REPLACED', 'ATTENDANCE_REMOVED', 'NO_CLASS_MARKED', 'NO_CLASS_REMOVED',
  'CONTENT_EDITED', 'CONTENT_DELETED', 'COURSE_ADDED', 'COURSE_EDITED', 'COURSE_DELETED',
  'MEETING_ADDED', 'MEETING_EDITED', 'MEETING_DELETED', 'SCHEDULE_EDITED', 'SCHEDULE_DELETED',
  'FORUM_MODERATED', 'FORUM_QUESTION_DELETED', 'FORUM_ANSWER_REMOVED', 'COMMENT_REMOVED',
  'ANNOUNCEMENT_POSTED', 'ANNOUNCEMENT_PINNED', 'MEMBER_LEFT',
  'POLL_CREATED', 'POLL_UPDATED', 'POLL_CLOSED', 'POLL_DELETED',
  'GROUPING_CREATED', 'GROUPING_UPDATED', 'GROUPING_DELETED',
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** The History screen's filter groups. Each list stays under Firestore's 30 values for an "in" query. */
export const HISTORY_GROUPS = {
  MONEY: ['PAYMENT', 'WITHDRAWAL', 'OPENING', 'OPENING_PENDING', 'CHARGE', 'PAYOUT', 'VOID', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'LEDGER_SETTINGS', 'REMINDERS'],
  ATTENDANCE: ['ATTENDANCE_TAKEN', 'ATTENDANCE_REPLACED', 'ATTENDANCE_REMOVED'],
  SCHEDULE: ['NO_CLASS_MARKED', 'NO_CLASS_REMOVED', 'MEETING_ADDED', 'MEETING_EDITED', 'MEETING_DELETED', 'SCHEDULE_EDITED', 'SCHEDULE_DELETED', 'COURSE_ADDED', 'COURSE_EDITED', 'COURSE_DELETED'],
  NEWS: ['ANNOUNCEMENT_POSTED', 'ANNOUNCEMENT_EDITED', 'ANNOUNCEMENT_DELETED', 'ANNOUNCEMENT_PINNED', 'COMMENT_REMOVED', 'FORUM_MODERATED', 'FORUM_QUESTION_DELETED', 'FORUM_ANSWER_REMOVED', 'POLL_CREATED', 'POLL_UPDATED', 'POLL_CLOSED', 'POLL_DELETED'],
  CONTENTS: ['CONTENT_EDITED', 'CONTENT_DELETED'],
  PEOPLE: ['JOIN_APPROVED', 'JOIN_REJECTED', 'MEMBER_REMOVED', 'MEMBER_LEFT', 'MEMBER_ROLE', 'MEMBER_COURSES', 'ROLE_SAVED', 'ROLE_DELETED', 'MAYOR_HANDOVER', 'GROUPING_CREATED', 'GROUPING_UPDATED', 'GROUPING_DELETED'],
  SETTINGS: ['CLASS_SETTINGS', 'CLASS_PHOTO', 'INVITE_CODE'],
} satisfies Record<string, HistoryKind[]>;
export type HistoryGroup = keyof typeof HISTORY_GROUPS;

/** A History entry to save with an action: what kind, who did it, and the sentence. */
export interface LogNote {
  actorUid: string;
  kind: HistoryKind;
  text: string;
}

/** Firestore: classes/{classId}/history/{id}. Create only. */
export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  /** What was done, in a sentence without the officer's name: "Recorded a payment of ₱50.00 from Juan Dela Cruz". */
  text: string;
  actorUid: string;
  /** The officer's name in the class when they did it (the screen prefers their current name). */
  actorName: string;
  atMillis: number;
}

export const HISTORY_TEXT_MAX = 300;

export const historyCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'history');

/** One word per permission, named after the tab it opens up (as in the Roles list). */
export const PERMISSION_WORDS: Record<string, string> = {
  RECORDS_MANAGE: 'Ledger', SCHEDULE_MANAGE: 'Schedule', MEMBERS_MANAGE: 'Members', ROLES_MANAGE: 'Roles',
  CLASS_SETTINGS: 'Settings', CONTENTS_MANAGE: 'Contents', ANNOUNCEMENTS_MANAGE: 'News', ATTENDANCE_MANAGE: 'Attendance',
};

/** "₱50.00", for the sentences below. */
export const peso = (centavos: number) => formatMoney(centavos);

/**
 * Adds the history entry for an action to the action's batch. Reads the officer's member entry for their
 * name (from the cache when it is there).
 */
export async function logToBatch(batch: WriteBatch, db: Firestore, classId: string, actorUid: string, kind: HistoryKind, text: string): Promise<void> {
  const me = await readFast(memberRef(db, classId, actorUid)).catch(() => null);
  const actorName = String(me?.get('name') ?? '').trim().slice(0, 90) || 'An officer';
  const clean = text.trim().replace(/\s+/g, ' ');
  batch.set(doc(historyCol(db, classId), newId()), {
    kind,
    text: clean.length > HISTORY_TEXT_MAX ? `${clean.slice(0, HISTORY_TEXT_MAX - 1)}…` : clean,
    actorUid,
    actorName,
    atMillis: nowMillis(),
  });
}

/** Saves an action's writes and, when a note is given, its History entry, together in one batch. */
export async function commitLogged(db: Firestore, classId: string, note: LogNote | null | undefined, write: (batch: WriteBatch) => void): Promise<void> {
  const batch = writeBatch(db);
  write(batch);
  if (note) await logToBatch(batch, db, classId, note.actorUid, note.kind, note.text);
  await batch.commit();
}

function toHistoryEntry(snap: DocumentSnapshot): HistoryEntry {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    kind: (HISTORY_KINDS as readonly string[]).includes(d.kind) ? d.kind : 'CLASS_SETTINGS',
    text: String(d.text ?? ''),
    actorUid: String(d.actorUid ?? ''),
    actorName: String(d.actorName ?? ''),
    atMillis: Number(d.atMillis ?? 0),
  };
}

/** What the History screen asks for: a group of kinds, one officer, and entries up to a moment. */
export interface HistoryFilter {
  group?: HistoryGroup;
  actorUid?: string;
  upToMillis?: number;
}

/**
 * The newest `count` entries that match the filter, newest first (CLASS_SETTINGS only; pass enabled=false for
 * anyone else). The filter runs in Firestore, so older matches are found however busy the log is.
 */
export function useHistory(db: Firestore, classId: string, count: number, enabled: boolean, filter: HistoryFilter = {}) {
  const where_: QueryConstraint[] = [];
  if (filter.group) where_.push(where('kind', 'in', HISTORY_GROUPS[filter.group]));
  if (filter.actorUid) where_.push(where('actorUid', '==', filter.actorUid));
  if (filter.upToMillis) where_.push(where('atMillis', '<=', filter.upToMillis));
  return useQueryList<HistoryEntry>(
    `v2/history/${classId}/${count}/${enabled}/${filter.group ?? ''}/${filter.actorUid ?? ''}/${filter.upToMillis ?? 0}`,
    enabled ? query(historyCol(db, classId), ...where_, orderBy('atMillis', 'desc'), limit(count)) : null,
    toHistoryEntry,
  );
}

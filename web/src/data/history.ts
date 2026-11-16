import { collection, doc, limit, orderBy, query, type DocumentSnapshot, type Firestore, type WriteBatch } from 'firebase/firestore';
import { formatMoney } from '../domain/money';
import { newId, nowMillis } from './dataEnv';
import { useQueryList } from './live';
import { memberRef, readFast } from './paths';

/*
 * The history log: classes/{classId}/history/{id}, one entry per officer action on money and people
 * (ledger, claims, members, roles, invite code, class settings). Each entry is written in the same batch
 * as the action, so an action and its entry are saved together or not at all. The rules make the log
 * append-only (nobody edits or deletes an entry; they go with the class) and only let people with
 * CLASS_SETTINGS read it.
 */

export const HISTORY_KINDS = [
  'PAYMENT', 'WITHDRAWAL', 'OPENING', 'OPENING_PENDING', 'CHARGE', 'PAYOUT', 'VOID', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'LEDGER_SETTINGS',
  'JOIN_APPROVED', 'JOIN_REJECTED', 'MEMBER_REMOVED', 'MEMBER_ROLE', 'MEMBER_COURSES', 'ROLE_SAVED', 'ROLE_DELETED', 'MAYOR_HANDOVER', 'INVITE_CODE',
  'CLASS_SETTINGS', 'CLASS_PHOTO', 'REMINDERS',
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

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

/** The newest `count` entries, newest first (CLASS_SETTINGS only; pass enabled=false for anyone else). */
export function useHistory(db: Firestore, classId: string, count: number, enabled: boolean) {
  return useQueryList<HistoryEntry>(
    `v2/history/${classId}/${count}/${enabled}`,
    enabled ? query(historyCol(db, classId), orderBy('atMillis', 'desc'), limit(count)) : null,
    toHistoryEntry,
  );
}

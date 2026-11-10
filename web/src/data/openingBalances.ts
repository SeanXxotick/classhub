import { deleteDoc, getDoc, getDocs, setDoc, writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore';
import type { Member, PendingOpeningBalance } from './models';
import { Ledger } from '../domain/ledger';
import { LedgerForms } from '../domain/ledgerForms';
import { UserError } from './errors';
import { buildRecord } from './ledgerStore';
import {
  bumpSummary,
  addSummaryDeltas,
  explainRefusal,
  membersCol,
  openingBalanceRef,
  openingBalancesCol,
  readOpenClass,
  recordRef,
  toMember,
  toPendingOpeningBalance,
  withoutId,
} from './paths';

/*
 * Opening balances (docs/PLAN-V2.md, "Opening balances" and "Pending opening balances"). An OPENING record
 * has the fixed id opening-{uid}, so a pending entry can never be applied twice. Only when that record was
 * voided (a mistake being corrected) does the next one take opening-{uid}-2, -3 and so on.
 */

function checkSigned(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > LedgerForms.MAX_AMOUNT_CENTAVOS) {
    throw new UserError('OPENING_AMOUNT_INVALID');
  }
}

function checkNote(note: string): string {
  const t = note.trim();
  if (t.length > 200) throw new UserError('NOTE_TOO_LONG');
  return t;
}

/** The record id the student's next opening balance takes, or null when a live opening balance already exists. */
export async function openingRecordIdFor(db: Firestore, classId: string, uid: string): Promise<string | null> {
  for (let n = 1; n <= 20; n++) {
    const id = n === 1 ? `opening-${uid}` : `opening-${uid}-${n}`;
    const snap = await getDoc(recordRef(db, classId, id));
    if (!snap.exists()) return id;
    if (!snap.get('voidedAtMillis')) return null;
  }
  return null;
}

/** Adds the OPENING record, deletes any pending entry for the student and moves the summary, inside batch. */
export function addOpeningToBatch(
  batch: WriteBatch, db: Firestore, actorUid: string, classId: string, recordId: string,
  student: { uid: string; name: string }, amountCentavos: number, note: string,
): ReturnType<typeof buildRecord> {
  const record = buildRecord('OPENING', amountCentavos, actorUid, { memberId: student.uid, memberName: student.name, note: note || 'Opening balance' });
  batch.set(recordRef(db, classId, recordId), withoutId(record));
  batch.delete(openingBalanceRef(db, classId, student.uid));
  return record;
}

/**
 * Sets (creates or replaces) the pending opening balance of a student who is not in the class yet
 * (RECORDS_MANAGE). Signed: negative when the student owed. It is applied once they are a member.
 */
export async function setPendingOpeningBalance(db: Firestore, classId: string, studentUid: string, amountCentavos: number, note = ''): Promise<void> {
  checkSigned(amountCentavos);
  await readOpenClass(db, classId);
  await explainRefusal(db, classId, () => setDoc(openingBalanceRef(db, classId, studentUid), { amountCentavos, note: checkNote(note) }));
}

export async function removePendingOpeningBalance(db: Firestore, classId: string, studentUid: string): Promise<void> {
  await explainRefusal(db, classId, () => deleteDoc(openingBalanceRef(db, classId, studentUid)));
}

export async function listPendingOpeningBalances(db: Firestore, classId: string): Promise<PendingOpeningBalance[]> {
  return (await getDocs(openingBalancesCol(db, classId))).docs.map(toPendingOpeningBalance);
}

/**
 * Enters the opening balance of a student who is already a member, as an OPENING record with its summary
 * change (RECORDS_MANAGE). Replaces any pending entry for them. Refused when they already have a live one.
 */
export async function addOpeningBalance(
  db: Firestore, actorUid: string, classId: string, input: { memberId: string; memberName: string; amountCentavos: number; note?: string },
): Promise<string> {
  checkSigned(input.amountCentavos);
  if (!input.memberId.trim()) throw new UserError('MEMBER_MISSING');
  const note = checkNote(input.note ?? '');
  await readOpenClass(db, classId);
  const id = await openingRecordIdFor(db, classId, input.memberId);
  if (!id) throw new UserError('OPENING_EXISTS');
  const batch = writeBatch(db);
  const record = addOpeningToBatch(batch, db, actorUid, classId, id, { uid: input.memberId, name: input.memberName }, input.amountCentavos, note);
  bumpSummary(batch, db, classId, Ledger.summaryDelta(record));
  await explainRefusal(db, classId, () => batch.commit());
  return id;
}

/**
 * Applies every pending opening balance whose student is now a member: the OPENING record, the entry
 * deleted and the summary, in one batch. Run by a records manager's app when the ledger opens.
 * conflicts lists students who already have a live opening balance (left pending for a person to decide).
 */
export async function applyPendingOpeningBalances(
  db: Firestore, actorUid: string, classId: string,
): Promise<{ applied: string[]; waiting: string[]; conflicts: string[] }> {
  const [pending, members] = await Promise.all([listPendingOpeningBalances(db, classId), getDocs(membersCol(db, classId))]);
  const byUid = new Map<string, Member>(members.docs.map((d) => [d.id, toMember(d)]));
  const result = { applied: [] as string[], waiting: [] as string[], conflicts: [] as string[] };
  if (pending.length === 0) return result;
  await readOpenClass(db, classId);
  const batch = writeBatch(db);
  const deltas = [];
  for (const entry of pending) {
    const member = byUid.get(entry.id);
    if (!member) {
      result.waiting.push(entry.id);
      continue;
    }
    const id = await openingRecordIdFor(db, classId, entry.id);
    if (!id) {
      result.conflicts.push(entry.id);
      continue;
    }
    const record = addOpeningToBatch(batch, db, actorUid, classId, id, { uid: member.id, name: member.name }, entry.amountCentavos, entry.note);
    deltas.push(Ledger.summaryDelta(record));
    result.applied.push(entry.id);
    // Two writes per student plus the summary: stay well inside one batch.
    if (result.applied.length >= 200) break;
  }
  if (deltas.length === 0) return result;
  bumpSummary(batch, db, classId, addSummaryDeltas(deltas));
  await explainRefusal(db, classId, () => batch.commit());
  return result;
}

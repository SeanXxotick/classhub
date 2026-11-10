import {
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  runTransaction,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { newRecord, type LedgerRecord, type RecordType, type StoredFundSummary } from './models';
import { Ledger } from '../domain/ledger';
import { LedgerForms } from '../domain/ledgerForms';
import { can } from '../domain/permissions';
import { UserError } from './errors';
import { newId, nowMillis } from './dataEnv';
import {
  addSummaryDeltas,
  bumpSummary,
  chargeRef,
  explainRefusal,
  readMyRole,
  readOpenClass,
  recordRef,
  recordsCol,
  summaryRef,
  toCharge,
  toRecord,
  withoutId,
} from './paths';

/*
 * Ledger writes (docs/PLAN-V2.md, "One document per charge", "No limits on balances"). Every record write
 * carries its summary increment in the same batch. Balances are never checked: only the amount guard.
 */

function checkAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError('AMOUNT_INVALID');
  if (amount > LedgerForms.MAX_AMOUNT_CENTAVOS) throw new UserError('AMOUNT_TOO_LARGE');
}

function checkNote(note: string): string {
  const t = note.trim();
  if (t.length > 200) throw new UserError('NOTE_TOO_LONG');
  return t;
}

function checkMember(memberId: string, memberName: string): void {
  if (!memberId.trim()) throw new UserError('MEMBER_MISSING');
  if (memberName.length > 90) throw new UserError('NAME_TOO_LONG');
}

export function checkReason(reason: string): string {
  const t = reason.trim();
  if (!t) throw new UserError('VOID_REASON_MISSING');
  if (t.length > 200) throw new UserError('VOID_REASON_TOO_LONG');
  return t;
}

/** A complete new record, signed by the writer at the current time and not voided. */
export function buildRecord(type: RecordType, amountCentavos: number, actorUid: string, fields: Partial<LedgerRecord>): LedgerRecord {
  const now = nowMillis();
  return newRecord({
    dateMillis: now, ...fields, type, amountCentavos, createdByUid: actorUid, createdAtMillis: now,
    claimId: '', voidedAtMillis: 0, voidedByUid: '', voidReason: '',
  });
}

export interface MemberRecordInput {
  memberId: string;
  memberName: string;
  amountCentavos: number;
  dateMillis?: number;
  note?: string;
}

async function addMemberRecord(db: Firestore, actorUid: string, classId: string, type: 'PAYMENT' | 'WITHDRAWAL', input: MemberRecordInput): Promise<string> {
  checkAmount(input.amountCentavos);
  checkMember(input.memberId, input.memberName);
  const record = buildRecord(type, input.amountCentavos, actorUid, {
    memberId: input.memberId, memberName: input.memberName, note: checkNote(input.note ?? ''), dateMillis: input.dateMillis ?? nowMillis(),
  });
  const id = newId();
  const batch = writeBatch(db);
  batch.set(recordRef(db, classId, id), withoutId(record));
  bumpSummary(batch, db, classId, Ledger.summaryDelta(record));
  await explainRefusal(db, classId, () => batch.commit());
  return id;
}

/** A student pays money in (RECORDS_MANAGE). Returns the record id. */
export const addPayment = (db: Firestore, actorUid: string, classId: string, input: MemberRecordInput) =>
  addMemberRecord(db, actorUid, classId, 'PAYMENT', input);

/** A student takes money out. May be larger than their balance (they then owe the class). */
export const addWithdrawal = (db: Firestore, actorUid: string, classId: string, input: MemberRecordInput) =>
  addMemberRecord(db, actorUid, classId, 'WITHDRAWAL', input);

export interface ChargeShare {
  memberId: string;
  memberName: string;
  amountCentavos: number;
}

export interface ChargeInput {
  note: string;
  courseId?: string;
  dateMillis?: number;
  shares: ChargeShare[];
  /** Also pay the total out of the fund in the same batch. */
  payout?: { paidTo: string; note?: string };
}

/**
 * Charges students: the charge document, one CHARGE share per student, the optional pay-out and the summary,
 * in one batch (at most 497 shares, so the batch stays at 500 writes). Returns the batch id and pay-out id.
 * Build shares from ChargePlanner.preview: charged.map((m) => ({ memberId: m.id, memberName: m.name, amountCentavos: per })).
 */
export async function chargeStudents(db: Firestore, actorUid: string, classId: string, input: ChargeInput): Promise<{ batchId: string; payoutRecordId: string }> {
  const note = checkNote(input.note);
  if (!note) throw new UserError('CHARGE_NOTE_MISSING');
  const { shares } = input;
  if (shares.length === 0) throw new UserError('CHARGE_NOBODY');
  if (shares.length > LedgerForms.MAX_CHARGED) throw new UserError('CHARGE_TOO_MANY');
  if (new Set(shares.map((s) => s.memberId)).size !== shares.length) throw new UserError('CHARGE_TWICE');
  shares.forEach((s) => { checkAmount(s.amountCentavos); checkMember(s.memberId, s.memberName); });
  const total = shares.reduce((a, s) => a + s.amountCentavos, 0);
  if (total > LedgerForms.MAX_AMOUNT_CENTAVOS) throw new UserError('CHARGE_TOTAL_TOO_LARGE');
  const paidTo = (input.payout?.paidTo ?? '').trim();
  if (paidTo.length > 100) throw new UserError('PAID_TO_TOO_LONG');

  const batchId = newId();
  const payoutRecordId = input.payout ? newId() : '';
  const now = nowMillis();
  const dateMillis = input.dateMillis ?? now;
  const courseId = input.courseId ?? '';
  const one = shares.every((s) => s.amountCentavos === shares[0].amountCentavos);
  const batch = writeBatch(db);
  batch.set(chargeRef(db, classId, batchId), {
    note, courseId, dateMillis, count: shares.length, totalCentavos: total, perMemberCentavos: one ? shares[0].amountCentavos : 0,
    payoutRecordId, voidedAtMillis: 0, voidedByUid: '', voidReason: '', createdByUid: actorUid, createdAtMillis: now,
  });
  const written: LedgerRecord[] = [];
  for (const s of shares) {
    const r = buildRecord('CHARGE', s.amountCentavos, actorUid, { memberId: s.memberId, memberName: s.memberName, note, dateMillis, batchId, courseId });
    batch.set(recordRef(db, classId, newId()), withoutId(r));
    written.push(r);
  }
  if (input.payout) {
    const p = buildRecord('EXPENSE', total, actorUid, { note: checkNote(input.payout.note ?? note) || note, dateMillis, courseId, settlesBatchId: batchId, paidTo });
    batch.set(recordRef(db, classId, payoutRecordId), withoutId(p));
    written.push(p);
  }
  bumpSummary(batch, db, classId, addSummaryDeltas(written.map(Ledger.summaryDelta)));
  await explainRefusal(db, classId, () => batch.commit());
  return { batchId, payoutRecordId };
}

/**
 * Pays a charge out of the fund: the EXPENSE for exactly the charge's total, the charge's payoutRecordId and
 * the summary, in one batch. A second pay-out of the same charge is refused (ALREADY_PAID_OUT).
 */
export async function payOutCharge(
  db: Firestore, actorUid: string, classId: string, batchId: string, input: { paidTo: string; note?: string; dateMillis?: number },
): Promise<string> {
  const paidTo = input.paidTo.trim();
  if (paidTo.length > 100) throw new UserError('PAID_TO_TOO_LONG');
  const snap = await getDoc(chargeRef(db, classId, batchId));
  if (!snap.exists()) throw new UserError('CHARGE_NOT_FOUND');
  const charge = toCharge(snap);
  if (charge.voidedAtMillis) throw new UserError('CHARGE_VOIDED');
  if (charge.payoutRecordId) throw new UserError('ALREADY_PAID_OUT');
  const id = newId();
  const payout = buildRecord('EXPENSE', charge.totalCentavos, actorUid, {
    note: checkNote(input.note ?? '') || charge.note, dateMillis: input.dateMillis ?? nowMillis(), courseId: charge.courseId, settlesBatchId: batchId, paidTo,
  });
  const batch = writeBatch(db);
  batch.set(recordRef(db, classId, id), withoutId(payout));
  batch.update(chargeRef(db, classId, batchId), { payoutRecordId: id });
  bumpSummary(batch, db, classId, Ledger.summaryDelta(payout));
  try {
    await explainRefusal(db, classId, () => batch.commit());
  } catch (e) {
    // Another treasurer may have paid it out first.
    const fresh = await getDocFromServer(chargeRef(db, classId, batchId)).catch(() => null);
    if (fresh?.exists() && fresh.get('payoutRecordId')) throw new UserError('ALREADY_PAID_OUT');
    throw e;
  }
  return id;
}

const voidFields = (actorUid: string, reason: string) => ({ voidedAtMillis: nowMillis(), voidedByUid: actorUid, voidReason: reason });

/**
 * Voids one record with a reason (PAYMENT, WITHDRAWAL, OPENING or a pay-out). A pay-out is voided together
 * with clearing its charge's payoutRecordId, so the charge can be paid out again. CHARGE shares are voided
 * only with their whole charge (voidCharge).
 */
export async function voidRecord(db: Firestore, actorUid: string, classId: string, recordId: string, reason: string): Promise<void> {
  const why = checkReason(reason);
  const snap = await getDoc(recordRef(db, classId, recordId));
  if (!snap.exists()) throw new UserError('RECORD_NOT_FOUND');
  const record = toRecord(snap);
  if (record.voidedAtMillis) throw new UserError('ALREADY_VOIDED');
  if (record.type === 'CHARGE') throw new UserError('VOID_SHARE_ALONE');
  const batch = writeBatch(db);
  batch.update(snap.ref, voidFields(actorUid, why));
  if (record.type === 'EXPENSE') batch.update(chargeRef(db, classId, record.settlesBatchId), { payoutRecordId: '' });
  bumpSummary(batch, db, classId, Ledger.summaryDeltaForVoid(record));
  try {
    await explainRefusal(db, classId, () => batch.commit());
  } catch (e) {
    const fresh = await getDocFromServer(snap.ref).catch(() => null);
    if (fresh?.exists() && fresh.get('voidedAtMillis')) throw new UserError('ALREADY_VOIDED');
    throw e;
  }
}

/** voidRecord for a pay-out, named for the screen that offers it. */
export const voidPayout = voidRecord;

/**
 * Voids a whole charge: the charge document and every share in one batch, with the summary.
 * A paid-out charge needs its pay-out voided first (the rules make that a separate batch). With
 * voidPayoutFirst the function does both steps in order; without it, it refuses (PAID_OUT_VOID_PAYOUT_FIRST).
 * Safe to run again if the second step failed: the pay-out is already voided and the charge is no longer paid out.
 */
export async function voidCharge(
  db: Firestore, actorUid: string, classId: string, batchId: string, reason: string, options: { voidPayoutFirst?: boolean } = {},
): Promise<{ payoutVoided: boolean }> {
  const why = checkReason(reason);
  const snap = await getDoc(chargeRef(db, classId, batchId));
  if (!snap.exists()) throw new UserError('CHARGE_NOT_FOUND');
  const charge = toCharge(snap);
  if (charge.voidedAtMillis) throw new UserError('ALREADY_VOIDED');
  let payoutVoided = false;
  if (charge.payoutRecordId) {
    if (!options.voidPayoutFirst) throw new UserError('PAID_OUT_VOID_PAYOUT_FIRST');
    await voidRecord(db, actorUid, classId, charge.payoutRecordId, why);
    payoutVoided = true;
  }
  const shares = (await getDocs(query(recordsCol(db, classId), where('batchId', '==', batchId)))).docs
    .map(toRecord)
    .filter((r) => r.type === 'CHARGE' && !r.voidedAtMillis);
  const batch = writeBatch(db);
  const fields = voidFields(actorUid, why);
  batch.update(chargeRef(db, classId, batchId), fields);
  for (const r of shares) batch.update(recordRef(db, classId, r.id), fields);
  bumpSummary(batch, db, classId, addSummaryDeltas(shares.map(Ledger.summaryDeltaForVoid)));
  await explainRefusal(db, classId, () => batch.commit());
  return { payoutVoided };
}

// ---- Summary self-repair

const SUMMARY_KEYS = ['cashOnHandCentavos', 'waitingPayoutCentavos', 'balancesTotalCentavos', 'recordCount', 'updatedAtMillis'] as const;
const sameStored = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined) =>
  SUMMARY_KEYS.every((k) => (a ?? {})[k] === (b ?? {})[k]);

/**
 * Recomputes the fund totals from every record (read from the server, never a partial cache) and rewrites
 * summary/fund when Ledger.summaryMatches says it is off. Only for people with RECORDS_MANAGE (they read every
 * record and may write the summary); anyone else gets CANNOT_REPAIR before anything is read.
 * The rewrite is a transaction that re-reads the summary: if another write moved it since the records were
 * read, it starts again, so a concurrent record is never lost from the totals.
 */
export async function repairFundSummary(db: Firestore, uid: string, classId: string): Promise<'ok' | 'repaired' | 'busy'> {
  const role = await readMyRole(db, classId, uid);
  if (!can(role, 'RECORDS_MANAGE')) throw new UserError('CANNOT_REPAIR');
  await readOpenClass(db, classId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await getDocFromServer(summaryRef(db, classId));
    const records = (await getDocsFromServer(recordsCol(db, classId))).docs.map(toRecord);
    const stored = before.data() as Partial<StoredFundSummary> | undefined;
    if (Ledger.summaryMatches(stored, records) && Number.isInteger(stored?.updatedAtMillis)) return 'ok';
    const done = await runTransaction(db, async (tx) => {
      const now = await tx.get(summaryRef(db, classId));
      if (!sameStored(now.data(), before.data())) return false;
      tx.set(summaryRef(db, classId), { ...Ledger.summarize(records), updatedAtMillis: nowMillis() });
      return true;
    });
    if (done) return 'repaired';
  }
  // The summary kept moving (busy treasurers); the next opening of the ledger tries again.
  return 'busy';
}

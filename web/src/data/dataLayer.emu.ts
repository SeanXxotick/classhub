/*
 * The v2 data layer against the Firestore emulator with the real firestore.rules (docs/PLAN-V2.md, "Testing").
 * Every operation under test runs as a signed-in user through the rules; the rules-off "admin" connection is
 * used only to arrange fixtures and to look at what was stored.
 * Run: npm run test:emu (from web/). Invented names only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { Ledger } from '../domain/ledger';
import { newRecord, type LedgerRecord } from './models';
import { isUserError, type UserErrorCode } from './errors';
import { resetDataEnv, setDataEnv } from './dataEnv';
import { createClass, deleteClass, regenerateInviteCode, updateClassSettings, updateLedgerSettings } from './classes';
import {
  approveJoinRequest,
  cancelJoinRequest,
  changeMemberRole,
  handOverAndLeave,
  leaveClass,
  listJoinRequests,
  lookupInvite,
  rejectJoinRequest,
  renameMeEverywhere,
  requestToJoin,
  saveRole,
  deleteRole,
  watchMyClasses,
  type MyClasses,
} from './membership';
import { addPayment, addWithdrawal, chargeStudents, payOutCharge, repairFundSummary, voidCharge, voidRecord } from './ledgerStore';
import { addOpeningBalance, applyPendingOpeningBalances, listPendingOpeningBalances, setPendingOpeningBalance } from './openingBalances';
import { watchVisibleRecords, type VisibleRecords } from './ledgerWatch';
import { reportClientError } from './clientErrors';
import { newRole } from './models';
import {
  addNoClass, cancelClaim, confirmClaim, deleteAnnouncement, markSeen, meetingsOn, newAnnouncement, newClaim, newMeeting,
  rejectClaim, saveAnnouncement, saveMeeting, sendClaim,
} from './features';

const PROJECT = 'demo-classhub';
const HOST = '127.0.0.1';
const PORT = 8080;

const apps: FirebaseApp[] = [];
const dbs = new Map<string, Firestore>();

function connect(name: string, token: string | { sub: string; user_id: string }): Firestore {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `emu-${name}-${apps.length}`);
  apps.push(app);
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, HOST, PORT, { mockUserToken: token });
  return db;
}

/** The Firestore connection of a signed-in user (the emulator trusts the mock token). */
function as(uid: string): Firestore {
  if (!dbs.has(uid)) dbs.set(uid, connect(uid, { sub: uid, user_id: uid }));
  return dbs.get(uid)!;
}

let adminDb: Firestore;

async function rejects(p: Promise<unknown>, code: UserErrorCode): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (isUserError(e, code)) return;
    throw new Error(`expected ${code}, got ${String((e as Error)?.message ?? e)}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

async function deniedRead(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toMatchObject({ code: 'permission-denied' });
}

async function storedRecords(classId: string): Promise<LedgerRecord[]> {
  const snap = await getDocs(collection(adminDb, 'classes', classId, 'records'));
  return snap.docs.map((d) => newRecord({ ...(d.data() as Partial<LedgerRecord>), id: d.id }));
}

/** summary/fund must equal Ledger.summarize of the stored records, in whole numbers. Called after every money operation. */
async function expectSummaryMatches(classId: string): Promise<void> {
  const records = await storedRecords(classId);
  const summary = (await getDoc(doc(adminDb, 'classes', classId, 'summary', 'fund'))).data() ?? {};
  const wanted = Ledger.summarize(records);
  expect({
    cashOnHandCentavos: summary.cashOnHandCentavos,
    waitingPayoutCentavos: summary.waitingPayoutCentavos,
    balancesTotalCentavos: summary.balancesTotalCentavos,
    recordCount: summary.recordCount,
  }).toEqual(wanted);
  for (const k of Object.keys(wanted)) expect(Number.isInteger(summary[k])).toBe(true);
  expect(Number.isInteger(summary.updatedAtMillis)).toBe(true);
  expect(Ledger.booksDifference(records)).toBe(0);
}

function waitFor<T>(subscribe: (cb: (v: T) => void) => () => void, test: (v: T) => boolean, label: string): Promise<T> {
  return new Promise((resolveValue, reject) => {
    let un: (() => void) | null = null;
    let done = false;
    const timer = setTimeout(() => { un?.(); reject(new Error(`timed out waiting for ${label}`)); }, 15_000);
    un = subscribe((v) => {
      if (done || !test(v)) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => un?.(), 0);
      resolveValue(v);
    });
  });
}

let counter = 0;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

beforeAll(async () => {
  // The real rules file, loaded again so the tests never run against anything else.
  const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');
  const put = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: rules }] } }),
  });
  expect(put.ok).toBe(true);
  const cleared = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(cleared.ok).toBe(true);
  adminDb = connect('admin', 'owner');
  setDataEnv({
    newId: () => `id${String(++counter).padStart(5, '0')}`,
    newInviteCode: () => {
      let n = ++counter;
      let code = '';
      for (let i = 0; i < 6; i++) { code += CODE_ALPHABET[n % 32]; n = Math.floor(n / 32); }
      return code;
    },
  });
});

afterAll(async () => {
  resetDataEnv();
  await Promise.all(apps.map((a) => deleteApp(a)));
});

const MAYOR = { uid: 'mayorLara', name: 'Lara Dizon' };
const TREASURER = { uid: 'treasBen', name: 'Ben Ocampo' };
const STUDENT = { uid: 'stuCora', name: 'Cora Velasco' };
const LATE = { uid: 'stuDino', name: 'Dino Ferrer' };
const QUITTER = { uid: 'stuEla', name: 'Ela Manalo' };
const REJECTED = { uid: 'stuFio', name: 'Fio Santiago' };

let classId = '';
let code = '';

describe('classes and joining', () => {
  it('creates a class with every v2 field, default roles, the Mayor, the invite and an empty summary', async () => {
    ({ classId, inviteCode: code } = await createClass(as(MAYOR.uid), MAYOR, { name: 'BSIT 2B', description: 'Second year' }));
    const room = (await getDoc(doc(adminDb, 'classes', classId))).data()!;
    expect(room).toMatchObject({ ownerUid: MAYOR.uid, inviteCode: code, defaultRoleId: 'member', deletingAtMillis: 0, balanceVisibility: 'EVERYONE', paymentInfo: '' });
    expect(room.id).toBeUndefined();
    const roles = await getDocs(collection(adminDb, 'classes', classId, 'roles'));
    expect(roles.docs.map((d) => d.id).sort()).toEqual(['mayor', 'member', 'secretary', 'treasurer']);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'members', MAYOR.uid))).data()).toMatchObject({ uid: MAYOR.uid, roleId: 'mayor', approvedByUid: '' });
    expect((await getDoc(doc(adminDb, 'invites', code))).data()).toEqual({ classId, className: 'BSIT 2B' });
    await expectSummaryMatches(classId);
  });

  it('a student finds the class by code, asks to join, and cannot read the class while waiting', async () => {
    const invite = await lookupInvite(as(STUDENT.uid), ` ${code.toLowerCase()} `);
    expect(invite).toMatchObject({ classId, className: 'BSIT 2B' });
    expect(await lookupInvite(as(STUDENT.uid), 'ZZZZZZ')).toBeNull();
    await requestToJoin(as(STUDENT.uid), STUDENT, code);
    await rejects(requestToJoin(as(STUDENT.uid), STUDENT, code), 'ALREADY_REQUESTED');
    await deniedRead(getDoc(doc(as(STUDENT.uid), 'classes', classId)));
    const mine = await waitFor<MyClasses>((cb) => watchMyClasses(as(STUDENT.uid), STUDENT.uid, cb), (v) => v.requests.length === 1, 'the waiting request');
    expect(mine.classes).toEqual([]);
    expect(mine.requests[0]).toMatchObject({ classId, request: { uid: STUDENT.uid, className: 'BSIT 2B' } });
  });

  it('a student cancels their request; another is rejected; a plain member cannot list requests', async () => {
    await requestToJoin(as(QUITTER.uid), QUITTER, code);
    await cancelJoinRequest(as(QUITTER.uid), QUITTER.uid, classId);
    await requestToJoin(as(REJECTED.uid), REJECTED, code);
    expect((await listJoinRequests(as(MAYOR.uid), classId)).map((r) => r.uid).sort()).toEqual([STUDENT.uid, REJECTED.uid].sort());
    await rejectJoinRequest(as(MAYOR.uid), classId, REJECTED.uid);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'joinRequests', REJECTED.uid))).exists()).toBe(false);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'joinRequests', QUITTER.uid))).exists()).toBe(false);
  });

  it('the Mayor approves: member entry with the default role and the requested name, request removed', async () => {
    const result = await approveJoinRequest(as(MAYOR.uid), MAYOR.uid, classId, STUDENT.uid);
    expect(result.openingApplied).toBe(false);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'members', STUDENT.uid))).data()).toMatchObject({
      uid: STUDENT.uid, name: STUDENT.name, roleId: 'member', approvedByUid: MAYOR.uid, excludedCourseIds: [],
    });
    expect((await getDoc(doc(adminDb, 'classes', classId, 'joinRequests', STUDENT.uid))).exists()).toBe(false);
    const mine = await waitFor<MyClasses>((cb) => watchMyClasses(as(STUDENT.uid), STUDENT.uid, cb), (v) => v.classes.length === 1 && !!v.classes[0].room, 'the class');
    expect(mine.classes[0]).toMatchObject({ classId, room: { name: 'BSIT 2B' } });
    await deniedRead(listJoinRequests(as(STUDENT.uid), classId));
  });

  it('the Treasurer joins and is given the Treasurer role; a plain member cannot change roles', async () => {
    await requestToJoin(as(TREASURER.uid), TREASURER, code);
    await approveJoinRequest(as(MAYOR.uid), MAYOR.uid, classId, TREASURER.uid);
    await rejects(changeMemberRole(as(STUDENT.uid), STUDENT.uid, classId, TREASURER.uid, 'treasurer'), 'NO_PERMISSION');
    await changeMemberRole(as(MAYOR.uid), MAYOR.uid, classId, TREASURER.uid, 'treasurer');
    expect((await getDoc(doc(adminDb, 'classes', classId, 'members', TREASURER.uid))).get('roleId')).toBe('treasurer');
  });

  it('settings, ledger settings, a new invite code, a renamed member and a custom role', async () => {
    await updateClassSettings(as(MAYOR.uid), classId, { name: 'BSIT 2B (2nd Sem)', timetableEnabled: false });
    expect((await getDoc(doc(adminDb, 'invites', code))).get('className')).toBe('BSIT 2B (2nd Sem)');
    await rejects(updateLedgerSettings(as(STUDENT.uid), classId, { paymentInfo: 'Send it to me' }), 'NO_PERMISSION');
    await updateLedgerSettings(as(TREASURER.uid), classId, { balanceVisibility: 'TREASURERS', paymentInfo: 'GCash 0900 000 0000 (Ben)' });
    const newCode = await regenerateInviteCode(as(MAYOR.uid), classId);
    expect((await getDoc(doc(adminDb, 'invites', code))).exists()).toBe(false);
    expect((await getDoc(doc(adminDb, 'invites', newCode))).data()).toEqual({ classId, className: 'BSIT 2B (2nd Sem)' });
    code = newCode;
    expect(await renameMeEverywhere(as(STUDENT.uid), STUDENT.uid, 'Cora B. Velasco')).toBe(1);
    const roleId = await saveRole(as(MAYOR.uid), MAYOR.uid, classId, newRole({ name: 'PIO', permissions: ['SCHEDULE_MANAGE'] }), []);
    await changeMemberRole(as(MAYOR.uid), MAYOR.uid, classId, STUDENT.uid, roleId);
    await deleteRole(as(MAYOR.uid), classId, roleId);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'members', STUDENT.uid))).get('roleId')).toBe('member');
  });
});

describe('ledger', () => {
  let paymentId = '';

  it('a payment and a withdrawal larger than the balance (no limits); the amount guard still holds', async () => {
    const t = as(TREASURER.uid);
    paymentId = await addPayment(t, TREASURER.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 20000, note: 'November fund' });
    await expectSummaryMatches(classId);
    await addWithdrawal(t, TREASURER.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 50000 });
    await expectSummaryMatches(classId);
    await rejects(addPayment(t, TREASURER.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 0 }), 'AMOUNT_INVALID');
    await rejects(addPayment(t, TREASURER.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 100_000_001 }), 'AMOUNT_TOO_LARGE');
    await rejects(addPayment(as(STUDENT.uid), STUDENT.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 100 }), 'NO_PERMISSION');
  });

  it('voids a record once, with a reason', async () => {
    await voidRecord(as(TREASURER.uid), TREASURER.uid, classId, paymentId, 'Entered twice');
    await expectSummaryMatches(classId);
    await rejects(voidRecord(as(TREASURER.uid), TREASURER.uid, classId, paymentId, 'Again'), 'ALREADY_VOIDED');
    const stored = (await getDoc(doc(adminDb, 'classes', classId, 'records', paymentId))).data()!;
    expect(stored).toMatchObject({ voidedByUid: TREASURER.uid, voidReason: 'Entered twice' });
  });

  let batchId = '';
  it('charges students (charge document, shares, summary), pays out once, and refuses a second pay-out', async () => {
    const t = as(TREASURER.uid);
    const shares = [STUDENT, TREASURER, MAYOR].map((p) => ({ memberId: p.uid, memberName: p.name, amountCentavos: 600 }));
    ({ batchId } = await chargeStudents(t, TREASURER.uid, classId, { note: 'Quiz - Networking', courseId: 'net', shares }));
    await expectSummaryMatches(classId);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'charges', batchId))).data()).toMatchObject({ count: 3, totalCentavos: 1800, perMemberCentavos: 600, payoutRecordId: '' });
    const payoutId = await payOutCharge(t, TREASURER.uid, classId, batchId, { paidTo: 'Prof. Ilagan' });
    await expectSummaryMatches(classId);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'records', payoutId))).data()).toMatchObject({ type: 'EXPENSE', amountCentavos: 1800, settlesBatchId: batchId });
    await rejects(payOutCharge(as(MAYOR.uid), MAYOR.uid, classId, batchId, { paidTo: 'Prof. Ilagan' }), 'ALREADY_PAID_OUT');
  });

  it('voiding a paid-out charge takes two steps: refused alone, done with voidPayoutFirst', async () => {
    const t = as(TREASURER.uid);
    await rejects(voidCharge(t, TREASURER.uid, classId, batchId, 'Wrong course'), 'PAID_OUT_VOID_PAYOUT_FIRST');
    expect(await voidCharge(t, TREASURER.uid, classId, batchId, 'Wrong course', { voidPayoutFirst: true })).toEqual({ payoutVoided: true });
    await expectSummaryMatches(classId);
    const charge = (await getDoc(doc(adminDb, 'classes', classId, 'charges', batchId))).data()!;
    expect(charge.payoutRecordId).toBe('');
    expect(charge.voidedAtMillis).toBeGreaterThan(0);
    const shares = (await storedRecords(classId)).filter((r) => r.batchId === batchId);
    expect(shares.length).toBe(3);
    expect(shares.every((r) => r.voidedAtMillis > 0)).toBe(true);
    await rejects(voidCharge(t, TREASURER.uid, classId, batchId, 'Again'), 'ALREADY_VOIDED');
  });

  it('charge and pay out in one batch, with different amounts per student', async () => {
    const shares = [{ memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 500 }, { memberId: MAYOR.uid, memberName: MAYOR.name, amountCentavos: 700 }];
    const r = await chargeStudents(as(TREASURER.uid), TREASURER.uid, classId, { note: 'Shirts', shares, payout: { paidTo: 'Print shop' } });
    expect((await getDoc(doc(adminDb, 'classes', classId, 'charges', r.batchId))).data()).toMatchObject({ perMemberCentavos: 0, totalCentavos: 1200, payoutRecordId: r.payoutRecordId });
    await expectSummaryMatches(classId);
  });

  it('a 40-student charge commits in one batch', async () => {
    const shares = Array.from({ length: 40 }, (_, i) => ({ memberId: `ghost${i}`, memberName: `Student ${i}`, amountCentavos: 1500 }));
    await chargeStudents(as(TREASURER.uid), TREASURER.uid, classId, { note: 'Field trip', shares, payout: { paidTo: 'Bus company' } });
    await expectSummaryMatches(classId);
  });

  it('opening balances: an existing member, and a pending one applied on approval or by the records manager', async () => {
    const t = as(TREASURER.uid);
    await addOpeningBalance(t, TREASURER.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: -4500, note: 'From 1st sem' });
    await expectSummaryMatches(classId);
    await rejects(addOpeningBalance(t, TREASURER.uid, classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 100 }), 'OPENING_EXISTS');
    expect((await getDoc(doc(adminDb, 'classes', classId, 'records', `opening-${STUDENT.uid}`))).get('amountCentavos')).toBe(-4500);

    // Pending for a student who has not joined yet; the Mayor (who also manages records) approves.
    await setPendingOpeningBalance(t, classId, LATE.uid, 25000, 'Carried over');
    expect((await listPendingOpeningBalances(t, classId)).map((p) => p.id)).toEqual([LATE.uid]);
    await requestToJoin(as(LATE.uid), LATE, code);
    expect(await approveJoinRequest(as(MAYOR.uid), MAYOR.uid, classId, LATE.uid)).toEqual({ openingApplied: true });
    expect((await getDoc(doc(adminDb, 'classes', classId, 'records', `opening-${LATE.uid}`))).data()).toMatchObject({ type: 'OPENING', amountCentavos: 25000, memberId: LATE.uid });
    expect(await listPendingOpeningBalances(t, classId)).toEqual([]);
    await expectSummaryMatches(classId);

    // An entry for someone already in the class (written by the import) is applied by the records manager's app.
    await setDoc(doc(adminDb, 'classes', classId, 'openingBalances', TREASURER.uid), { amountCentavos: 1000, note: '' });
    expect(await applyPendingOpeningBalances(t, TREASURER.uid, classId)).toEqual({ applied: [TREASURER.uid], waiting: [], conflicts: [] });
    await expectSummaryMatches(classId);
  });

  it('the summary self-repair fixes a wrong summary, and refuses someone who does not manage records', async () => {
    await updateDoc(doc(adminDb, 'classes', classId, 'summary', 'fund'), { cashOnHandCentavos: 123, recordCount: 1 });
    await rejects(repairFundSummary(as(STUDENT.uid), STUDENT.uid, classId), 'CANNOT_REPAIR');
    expect(await repairFundSummary(as(TREASURER.uid), TREASURER.uid, classId)).toBe('repaired');
    await expectSummaryMatches(classId);
    expect(await repairFundSummary(as(TREASURER.uid), TREASURER.uid, classId)).toBe('ok');
  });
});

describe('who reads which records', () => {
  const watch = (uid: string, listened: string[]) => (cb: (v: VisibleRecords) => void) =>
    watchVisibleRecords(as(uid), classId, uid, cb, (e) => { throw e; }, { onListen: (w) => listened.push(w) });

  it('a plain member gets only their own records and the pay-outs under TREASURERS and OFFICERS', async () => {
    for (const setting of ['TREASURERS', 'OFFICERS'] as const) {
      await updateLedgerSettings(as(TREASURER.uid), classId, { balanceVisibility: setting });
      const listened: string[] = [];
      const v = await waitFor(watch(STUDENT.uid, listened), (x) => x.scope !== 'NONE' && x.records.length > 0, `own records (${setting})`);
      expect(v.scope).toBe('OWN');
      expect(listened).not.toContain('ALL');
      expect(v.records.every((r) => r.memberId === STUDENT.uid || r.type === 'EXPENSE')).toBe(true);
      expect(v.records.some((r) => r.type === 'EXPENSE')).toBe(true);
    }
  });

  it('under EVERYONE the member reads every record; switching the setting switches the queries without an error', async () => {
    await updateLedgerSettings(as(TREASURER.uid), classId, { balanceVisibility: 'EVERYONE' });
    const listened: string[] = [];
    const seen: VisibleRecords[] = [];
    const errors: Error[] = [];
    const un = watchVisibleRecords(as(STUDENT.uid), classId, STUDENT.uid, (v) => seen.push(v), (e) => errors.push(e), { onListen: (w) => listened.push(w) });
    const until = async (test: () => boolean, label: string) => {
      for (let i = 0; i < 150 && !test(); i++) await new Promise((r) => setTimeout(r, 100));
      if (!test()) throw new Error(`timed out: ${label}`);
    };
    await until(() => seen.some((v) => v.scope === 'ALL' && v.records.some((r) => r.memberId === TREASURER.uid)), 'every record');
    await updateLedgerSettings(as(TREASURER.uid), classId, { balanceVisibility: 'TREASURERS' });
    await until(() => seen.at(-1)?.scope === 'OWN', 'own records after the switch');
    expect(seen.at(-1)!.records.every((r) => r.memberId === STUDENT.uid || r.type === 'EXPENSE')).toBe(true);
    await changeMemberRole(as(MAYOR.uid), MAYOR.uid, classId, STUDENT.uid, 'treasurer');
    await until(() => seen.at(-1)?.scope === 'ALL', 'every record after becoming Treasurer');
    await changeMemberRole(as(MAYOR.uid), MAYOR.uid, classId, STUDENT.uid, 'member');
    await until(() => seen.at(-1)?.scope === 'OWN', 'own records again');
    un();
    expect(errors).toEqual([]);
  });

  it('a waiting student gets nothing', async () => {
    await requestToJoin(as(QUITTER.uid), QUITTER, code);
    const v = await waitFor(watch(QUITTER.uid, []), () => true, 'a first answer');
    expect(v).toEqual({ records: [], scope: 'NONE' });
    await deniedRead(getDoc(doc(as(QUITTER.uid), 'classes', classId, 'summary', 'fund')));
  });
});

describe('claims, announcements and the timetable', () => {
  it('a student sends a claim; the Treasurer confirms it into a payment; another is rejected', async () => {
    const id = await sendClaim(as(STUDENT.uid), STUDENT, classId, { amountCentavos: 15000, method: 'GCASH', reference: 'REF123' });
    const claim = newClaim({ ...((await getDoc(doc(adminDb, 'classes', classId, 'claims', id))).data() as object), id });
    expect(claim.status).toBe('PENDING');
    // A plain member cannot decide it, and cannot read another student's claim.
    await expect(confirmClaim(as(STUDENT.uid), STUDENT.uid, classId, claim)).rejects.toBeTruthy();
    await deniedRead(getDoc(doc(as(LATE.uid), 'classes', classId, 'claims', id)));
    const recordId = await confirmClaim(as(TREASURER.uid), TREASURER.uid, classId, claim);
    const stored = (await getDoc(doc(adminDb, 'classes', classId, 'claims', id))).data()!;
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.recordId).toBe(recordId);
    const record = (await getDoc(doc(adminDb, 'classes', classId, 'records', recordId))).data()!;
    expect(record.claimId).toBe(id);
    expect(record.amountCentavos).toBe(15000);
    await expectSummaryMatches(classId);
    // Confirming twice is refused.
    await expect(confirmClaim(as(TREASURER.uid), TREASURER.uid, classId, claim)).rejects.toBeTruthy();

    const second = await sendClaim(as(STUDENT.uid), STUDENT, classId, { amountCentavos: 500, method: 'CASH', reference: '' });
    await rejectClaim(as(TREASURER.uid), TREASURER.uid, classId, second, 'No such payment arrived.');
    expect((await getDoc(doc(adminDb, 'classes', classId, 'claims', second))).get('status')).toBe('REJECTED');
    const third = await sendClaim(as(STUDENT.uid), STUDENT, classId, { amountCentavos: 700, method: 'MAYA', reference: 'X' });
    await cancelClaim(as(STUDENT.uid), classId, third);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'claims', third))).exists()).toBe(false);
    await expectSummaryMatches(classId);
  });

  it('the Mayor posts an announcement, a member marks it seen and cannot post', async () => {
    await saveAnnouncement(as(MAYOR.uid), MAYOR.uid, classId, newAnnouncement({ title: 'No uniform on Friday', body: 'Wear the class shirt.', pinned: true }));
    const posts = await getDocs(collection(adminDb, 'classes', classId, 'announcements'));
    expect(posts.size).toBe(1);
    const post = newAnnouncement({ ...(posts.docs[0].data() as object), id: posts.docs[0].id });
    await saveAnnouncement(as(MAYOR.uid), MAYOR.uid, classId, { ...post, title: 'No uniform this Friday' });
    await expect(saveAnnouncement(as(STUDENT.uid), STUDENT.uid, classId, newAnnouncement({ title: 'Hello' }))).rejects.toBeTruthy();
    await markSeen(as(STUDENT.uid), classId, STUDENT.uid, [post.id]);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'seen', STUDENT.uid))).get('announcements')[post.id]).toBeGreaterThan(0);
    await deleteAnnouncement(as(MAYOR.uid), classId, post.id);
  });

  it('the Mayor adds a weekly meeting and marks a day as no classes; a member cannot', async () => {
    await saveMeeting(as(MAYOR.uid), classId, newMeeting({ courseId: 'course1', dayOfWeek: 1, startMinutes: 480, endMinutes: 570, room: 'Room 204' }));
    await addNoClass(as(MAYOR.uid), MAYOR.uid, classId, '2026-11-16', '', 'Holiday');
    await expect(saveMeeting(as(STUDENT.uid), classId, newMeeting({ courseId: 'course1' }))).rejects.toBeTruthy();
    await expect(addNoClass(as(STUDENT.uid), STUDENT.uid, classId, '2026-11-17', '', '')).rejects.toBeTruthy();
    const meetings = (await getDocs(collection(adminDb, 'classes', classId, 'meetings'))).docs.map((d) => newMeeting({ ...(d.data() as object), id: d.id }));
    const marks = (await getDocs(collection(adminDb, 'classes', classId, 'noClass'))).docs.map((d) => ({ id: d.id, ...(d.data() as { dateKey: string; courseId: string; reason: string; createdByUid: string }) }));
    // 2026-11-16 is a Monday in Manila.
    const day = meetingsOn(meetings, marks, Date.UTC(2026, 10, 16, 2));
    expect(day).toHaveLength(1);
    expect(day[0].cancelled?.reason).toBe('Holiday');
    expect(meetingsOn(meetings, marks, Date.UTC(2026, 10, 23, 2))[0].cancelled).toBeNull();
  });
});

describe('leaving, error log and deleting a class', () => {
  it('a member leaves; the Mayor must hand over first', async () => {
    await leaveClass(as(LATE.uid), LATE.uid, classId);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'members', LATE.uid))).exists()).toBe(false);
    await rejects(leaveClass(as(MAYOR.uid), MAYOR.uid, classId), 'MUST_HAND_OVER');
  });

  it('writes an error report in the shape the rules accept', async () => {
    expect(await reportClientError(as(STUDENT.uid), { message: 'TypeError at someone@example.com', stack: 'at Ledger', appVersion: '2.0.0', platform: 'WEB' })).toBe(true);
    const all = await getDocs(collection(adminDb, 'clientErrors'));
    expect(all.docs[0].data()).toMatchObject({ message: 'TypeError at [email]', platform: 'WEB' });
  });

  it('refuses to delete a class whose books are not settled, and deletes a settled one completely', async () => {
    await rejects(deleteClass(as(MAYOR.uid), MAYOR.uid, classId), 'NOT_SETTLED');
    await rejects(deleteClass(as(TREASURER.uid), TREASURER.uid, classId), 'ONLY_MAYOR_DELETES');

    const owner = { uid: 'mayorGio', name: 'Gio Pascual' };
    const small = await createClass(as(owner.uid), owner, { name: 'Org Officers' });
    await requestToJoin(as(STUDENT.uid), STUDENT, small.inviteCode);
    await approveJoinRequest(as(owner.uid), owner.uid, small.classId, STUDENT.uid);
    await requestToJoin(as(REJECTED.uid), REJECTED, small.inviteCode);
    await setDoc(doc(as(owner.uid), 'classes', small.classId, 'schedule', 's1'), { title: 'Quiz 1', kind: 'QUIZ', dueMillis: 5 });
    await addPayment(as(owner.uid), owner.uid, small.classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 1000 });
    await addWithdrawal(as(owner.uid), owner.uid, small.classId, { memberId: STUDENT.uid, memberName: STUDENT.name, amountCentavos: 1000 });

    const steps: string[] = [];
    await deleteClass(as(owner.uid), owner.uid, small.classId, (p) => steps.push(p.step));
    expect(steps[0]).toBe('closing');
    expect(steps.at(-1)).toBe('done');
    expect((await getDoc(doc(adminDb, 'classes', small.classId))).exists()).toBe(false);
    expect((await getDoc(doc(adminDb, 'invites', small.inviteCode))).exists()).toBe(false);
    for (const sub of ['records', 'summary', 'members', 'roles', 'joinRequests', 'schedule']) {
      expect((await getDocs(collection(adminDb, 'classes', small.classId, sub))).size).toBe(0);
    }
  });

  it('the Mayor hands the class over and leaves', async () => {
    await handOverAndLeave(as(MAYOR.uid), MAYOR.uid, classId, TREASURER.uid);
    expect((await getDoc(doc(adminDb, 'classes', classId))).get('ownerUid')).toBe(TREASURER.uid);
    expect((await getDoc(doc(adminDb, 'classes', classId, 'members', TREASURER.uid))).get('roleId')).toBe('mayor');
  });
});

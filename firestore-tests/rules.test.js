// Tests for ../firestore.rules (ClassHub 2.0) against the local Firestore emulator.
// Run from the project folder:  firebase emulators:exec --only firestore --project demo-classhub "node firestore-tests/rules.test.js"
// Each test acts out what the v2 app writes, as a given user, and checks it is allowed or refused.
// A refusal is followed (in the same test or the next one) by the nearest valid write succeeding, so every
// refusal fails for the reason the test names. The script exits with 1 when any test fails.

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup, query, where, writeBatch, deleteField, increment,
} = require('firebase/firestore');

const CLASS = 'class1';
const CODE = 'K7M4QX';
const OTHER_CODE = 'QWERTY';
const NEW_CODE = 'NEW234';
const PERMS = ['RECORDS_MANAGE', 'SCHEDULE_MANAGE', 'MEMBERS_MANAGE', 'ROLES_MANAGE', 'CLASS_SETTINGS', 'CONTENTS_MANAGE', 'ANNOUNCEMENTS_MANAGE', 'ATTENDANCE_MANAGE'];
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let env;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e && e.message ? e.message.split('\n')[0] : String(e) });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
/** Seeds data that is not under test, the way an admin script would (rules switched off). */
const admin = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const now = () => Date.now();
const nameOf = (uid) => uid.charAt(0).toUpperCase() + uid.slice(1);
const omit = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

// ==================================================================== What the v2 app writes

const ROLES = {
  mayor: { id: '', name: 'Mayor', colorHex: '#7C3AED', permissions: PERMS, locked: true },
  treasurer: { id: '', name: 'Treasurer', colorHex: '#15803D', permissions: ['RECORDS_MANAGE'], locked: false },
  secretary: { id: '', name: 'Secretary', colorHex: '#3730A3', permissions: ['SCHEDULE_MANAGE', 'CONTENTS_MANAGE', 'ANNOUNCEMENTS_MANAGE', 'ATTENDANCE_MANAGE'], locked: false },
  member: { id: '', name: 'Member', colorHex: '#6B768A', permissions: [], locked: false },
};

/** classes/{classId}: newClassRoom in models.ts plus deletingAtMillis. */
function classData(owner, code, extra = {}) {
  return {
    id: '', name: 'BSM CS 3A', description: '', ownerUid: owner, accentColor: '#0F766E', inviteCode: code, defaultRoleId: 'member',
    ledgerEnabled: true, scheduleEnabled: true, contentsEnabled: true, announcementsEnabled: true, timetableEnabled: true,
    balanceVisibility: 'EVERYONE', paymentInfo: '', deletingAtMillis: 0,
    scheduleIcons: {}, scheduleColors: {}, contentIcons: {}, contentColors: {}, createdAtMillis: now(), ...extra,
  };
}

/** classes/{classId}/members/{uid}: newMember in models.ts. */
function memberData(uid, extra = {}) {
  return { id: '', uid, name: nameOf(uid), roleId: 'member', joinedAtMillis: now(), excludedCourseIds: [], approvedByUid: '', ...extra };
}

/** Creating a class: the class, the default roles, the creator's Mayor entry and the invite, in one batch. */
function createClassBatch(store, owner, opts = {}) {
  const { classId = CLASS, code = CODE, classFields = {}, dropClassFields = [], ownerFields = {}, dropOwnerFields = [], inviteFields = {} } = opts;
  const b = writeBatch(store);
  b.set(doc(store, `classes/${classId}`), omit(classData(owner, code, classFields), ...dropClassFields));
  for (const [id, r] of Object.entries(ROLES)) b.set(doc(store, `classes/${classId}/roles/${id}`), r);
  b.set(doc(store, `classes/${classId}/members/${owner}`), omit(memberData(owner, { roleId: 'mayor', ...ownerFields }), ...dropOwnerFields));
  b.set(doc(store, `invites/${code}`), { classId, className: 'BSM CS 3A', ...inviteFields });
  return b;
}

function joinRequestData(uid, extra = {}) {
  return { uid, name: nameOf(uid), className: 'BSM CS 3A', joinCode: CODE, requestedAtMillis: now(), ...extra };
}

/** A student enters a code: classes/{classId}/joinRequests/{uid}. */
function requestJoin(store, uid, { classId = CLASS, code = CODE, data = {} } = {}) {
  return setDoc(doc(store, `classes/${classId}/joinRequests/${uid}`), joinRequestData(uid, { joinCode: code, ...data }));
}

/** Approving: the member entry (default role, the requested name) is created and the request deleted, in one batch. */
function approveBatch(store, approver, student, { classId = CLASS, memberFields = {}, deleteRequest = true } = {}) {
  const b = writeBatch(store);
  b.set(doc(store, `classes/${classId}/members/${student}`), memberData(student, { approvedByUid: approver, ...memberFields }));
  if (deleteRequest) b.delete(doc(store, `classes/${classId}/joinRequests/${student}`));
  return b;
}

/** A student asks and an officer approves, both through the rules. */
async function joinVia(approver, student, { classId = CLASS, code = CODE } = {}) {
  await assertSucceeds(requestJoin(db(student), student, { classId, code }));
  await assertSucceeds(approveBatch(db(approver), approver, student, { classId }).commit());
}

/** The "My classes" queries. */
const myMemberEntries = (store, uid) => getDocs(query(collectionGroup(store, 'members'), where('uid', '==', uid)));
const myJoinRequests = (store, uid) => getDocs(query(collectionGroup(store, 'joinRequests'), where('uid', '==', uid)));

// ---- Ledger

/** classes/{classId}/records/{id}: newRecord in models.ts, saved with id '' as in v1. */
function rec(type, amount, by, extra = {}) {
  return {
    id: '', type, amountCentavos: amount, memberId: '', memberName: '', note: 'Quiz - OR', dateMillis: now(), batchId: '', courseId: '',
    createdByUid: by, settlesBatchId: '', paidTo: '', claimId: '', createdAtMillis: now(),
    voidedAtMillis: 0, voidedByUid: '', voidReason: '', ...extra,
  };
}
const payment = (by, member, amount = 10000, extra = {}) => rec('PAYMENT', amount, by, { memberId: member, memberName: nameOf(member), ...extra });

/** Ledger.summaryDelta: how one record moves the fund summary. */
function deltaOf(r) {
  const a = r.amountCentavos;
  switch (r.type) {
    case 'PAYMENT':
    case 'OPENING':
      return { cash: a, waiting: 0, balances: a, count: 1 };
    case 'WITHDRAWAL':
      return { cash: -a, waiting: 0, balances: -a, count: 1 };
    case 'CHARGE':
      return { cash: 0, waiting: a, balances: -a, count: 1 };
    case 'EXPENSE':
      return { cash: -a, waiting: -a, balances: 0, count: 1 };
  }
  throw new Error(`unknown type ${r.type}`);
}
const ZERO = { cash: 0, waiting: 0, balances: 0, count: 0 };
const addDeltas = (list) => list.reduce((s, d) => ({ cash: s.cash + d.cash, waiting: s.waiting + d.waiting, balances: s.balances + d.balances, count: s.count + d.count }), ZERO);
// 0 - x, not -x: -0 is sent as a double, which would turn a summary field into a non-integer (the rules refuse it).
// Ledger.summaryDeltaForVoid in the app does the same.
const negate = (d) => ({ cash: 0 - d.cash, waiting: 0 - d.waiting, balances: 0 - d.balances, count: 0 - d.count });

/** The summary change that goes in the same batch as every record write (increments, so two treasurers do not overwrite each other). */
function bumpSummary(b, store, classId, d) {
  b.set(doc(store, `classes/${classId}/summary/fund`), {
    cashOnHandCentavos: increment(d.cash),
    waitingPayoutCentavos: increment(d.waiting),
    balancesTotalCentavos: increment(d.balances),
    recordCount: increment(d.count),
    updatedAtMillis: now(),
  }, { merge: true });
}

/** One record and its summary change in one batch (payment, withdrawal, opening balance). */
function addRecordBatch(store, data, { classId = CLASS, id = null, summary = true } = {}) {
  const b = writeBatch(store);
  const ref = id ? doc(store, `classes/${classId}/records/${id}`) : doc(collection(store, `classes/${classId}/records`));
  b.set(ref, data);
  if (summary) bumpSummary(b, store, classId, deltaOf(data));
  return { b, ref, data };
}

/** A single record write without the summary, for checking the record rule alone. */
const tryRecord = (uid, data, classId = CLASS) => setDoc(doc(collection(db(uid), `classes/${classId}/records`)), data);

/** classes/{classId}/charges/{batchId}. */
function chargeData(by, count, per, extra = {}) {
  return {
    id: '', note: 'Quiz - OR', courseId: 'or', dateMillis: now(), count, totalCentavos: per * count, perMemberCentavos: per,
    payoutRecordId: '', voidedAtMillis: 0, voidedByUid: '', voidReason: '', createdByUid: by, createdAtMillis: now(), ...extra,
  };
}

/**
 * "Charge students": the charge document, one CHARGE share per student and the summary in one batch, plus the
 * pay-out when the treasurer pays it out at once (the charge document then names it in payoutRecordId).
 */
function chargeBatch(store, by, opts) {
  const {
    classId = CLASS, batchId, students, per = 600, amounts = null, payout = false,
    chargeFields = {}, shareFields = {}, payoutFields = {}, withCharge = true, summary = true,
  } = opts;
  const b = writeBatch(store);
  const records = `classes/${classId}/records`;
  const shareAmounts = amounts || students.map(() => per);
  const total = shareAmounts.reduce((x, y) => x + y, 0);
  const payoutRef = payout ? doc(collection(store, records)) : null;
  if (withCharge) {
    b.set(doc(store, `classes/${classId}/charges/${batchId}`), chargeData(by, students.length, amounts ? 0 : per, {
      totalCentavos: total, payoutRecordId: payoutRef ? payoutRef.id : '', ...chargeFields,
    }));
  }
  const shares = students.map((s, i) => {
    const ref = doc(collection(store, records));
    const data = rec('CHARGE', shareAmounts[i], by, { memberId: s, memberName: nameOf(s), batchId, courseId: 'or', ...shareFields });
    b.set(ref, data);
    return { ref, data };
  });
  let payoutRecord = null;
  if (payout) {
    payoutRecord = { ref: payoutRef, data: rec('EXPENSE', total, by, { settlesBatchId: batchId, paidTo: 'Prof. Santos', ...payoutFields }) };
    b.set(payoutRef, payoutRecord.data);
  }
  if (summary) bumpSummary(b, store, classId, addDeltas([...shares, ...(payoutRecord ? [payoutRecord] : [])].map((r) => deltaOf(r.data))));
  return { b, shares, payout: payoutRecord, total };
}

/** "Pay out from fund" for an existing charge: the EXPENSE, the charge's payoutRecordId and the summary in one batch. */
function payoutBatch(store, by, { classId = CLASS, batchId, amount, recordFields = {}, linkCharge = true } = {}) {
  const b = writeBatch(store);
  const ref = doc(collection(store, `classes/${classId}/records`));
  const data = rec('EXPENSE', amount, by, { settlesBatchId: batchId, paidTo: 'Prof. Santos', ...recordFields });
  b.set(ref, data);
  if (linkCharge) b.update(doc(store, `classes/${classId}/charges/${batchId}`), { payoutRecordId: ref.id });
  bumpSummary(b, store, classId, deltaOf(data));
  return { b, ref, data };
}

const voidFields = (by, reason = 'Entered twice', extra = {}) => ({ voidedAtMillis: now(), voidedByUid: by, voidReason: reason, ...extra });

/** Voiding one record and taking it out of the summary. */
function voidBatch(store, by, record, { classId = CLASS, reason = 'Entered twice', fields = {} } = {}) {
  const b = writeBatch(store);
  b.update(doc(store, record.ref.path), voidFields(by, reason, fields));
  bumpSummary(b, store, classId, negate(deltaOf(record.data)));
  return b;
}

/** Voiding a pay-out: the EXPENSE is voided and its charge's payoutRecordId cleared, so it can be paid out again. */
function voidPayoutBatch(store, by, payout, batchId, { classId = CLASS, voidRecord = true, clear = true } = {}) {
  const b = writeBatch(store);
  if (voidRecord) b.update(doc(store, payout.ref.path), voidFields(by, 'Paid to the wrong person'));
  if (clear) b.update(doc(store, `classes/${classId}/charges/${batchId}`), { payoutRecordId: '' });
  bumpSummary(b, store, classId, negate(deltaOf(payout.data)));
  return b;
}

/** Voiding a whole charge: the charge document and every share in one batch. */
function voidChargeBatch(store, by, batchId, shares, { classId = CLASS, voidDoc = true, chargeFields = {} } = {}) {
  const b = writeBatch(store);
  if (voidDoc) b.update(doc(store, `classes/${classId}/charges/${batchId}`), voidFields(by, 'Wrong course', chargeFields));
  for (const s of shares) b.update(doc(store, s.ref.path), voidFields(by, 'Wrong course'));
  bumpSummary(b, store, classId, negate(addDeltas(shares.map((s) => deltaOf(s.data)))));
  return b;
}

const photo = (size = 30000) => ({ photo: 'A'.repeat(size), updatedAtMillis: 1 });

async function main() {
  env = await initializeTestEnvironment({
    projectId: process.env.EMU_PROJECT || 'demo-classhub',
    // RULES_FILE lets a check run the same tests against a deliberately broken copy of the rules.
    firestore: { rules: fs.readFileSync(process.env.RULES_FILE || path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();

  // ---------------------------------------------------------------- Accounts

  await test('A user can write their own profile', () =>
    assertSucceeds(setDoc(doc(db('mayor'), 'users/mayor'), { displayName: 'Juan', email: 'juan@example.com' })));

  await test('A user cannot write someone else\'s profile', () =>
    assertFails(setDoc(doc(db('mayor'), 'users/student'), { displayName: 'Hacker' })));

  await test('Signed-out users cannot read anything', () =>
    assertFails(getDoc(doc(anon(), 'users/mayor'))));

  await test('The v1 "My classes" copy is gone: nobody reads or writes users/{uid}/memberships', async () => {
    await assertFails(setDoc(doc(db('mayor'), `users/mayor/memberships/${CLASS}`), { classId: '', className: 'BSM CS 3A', joinedAtMillis: 1 }));
    await assertFails(getDocs(collection(db('mayor'), 'users/mayor/memberships')));
  });

  await test('Push tokens are not open yet (users/{uid}/devices comes with notifications)', () =>
    assertFails(setDoc(doc(db('mayor'), 'users/mayor/devices/d1'), { token: 't', platform: 'WEB', updatedAtMillis: now() })));

  // ---------------------------------------------------------------- Creating a class

  await test('A class cannot name someone else as owner', () =>
    assertFails(createClassBatch(db('outsider'), 'mayor').commit()));

  await test('A class must start with a valid balance visibility', async () => {
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { balanceVisibility: 'ALL' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { dropClassFields: ['balanceVisibility'] }).commit());
  });

  await test('A class cannot start in the deleting state', async () => {
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { deletingAtMillis: now() } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { dropClassFields: ['deletingAtMillis'] }).commit());
  });

  await test('A class cannot carry unknown fields, a non-member default role or oversized payment info', async () => {
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { secret: true } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { defaultRoleId: 'treasurer' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { paymentInfo: 'x'.repeat(501) } }).commit());
  });

  await test('A class cannot be created with settings of the wrong type', async () => {
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { name: 5 } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { name: '   ' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { description: 'x'.repeat(201) } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { ledgerEnabled: 'yes' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { timetableEnabled: 1 } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { inviteCode: 'bad code!' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { classFields: { createdAtMillis: 'today' } }).commit());
  });

  await test('The creator\'s member entry must carry their uid, the Mayor role and no approver', async () => {
    await assertFails(createClassBatch(db('mayor'), 'mayor', { ownerFields: { uid: 'someone' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { dropOwnerFields: ['uid'] }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { ownerFields: { roleId: 'member' } }).commit());
    await assertFails(createClassBatch(db('mayor'), 'mayor', { ownerFields: { approvedByUid: 'someone' } }).commit());
  });

  await test('The invite holds only the class id and name (the v1 defaultRoleId is gone)', () =>
    assertFails(createClassBatch(db('mayor'), 'mayor', { inviteFields: { defaultRoleId: 'member' } }).commit()));

  await test('Creating a class (class, default roles, Mayor, invite) succeeds', () =>
    assertSucceeds(createClassBatch(db('mayor'), 'mayor', { classFields: { paymentInfo: 'x'.repeat(500) } }).commit()));

  await test('Another user creates their own class', () =>
    assertSucceeds(createClassBatch(db('owner2'), 'owner2', { classId: 'class2', code: OTHER_CODE }).commit()));

  await test('Creating a class over an existing class id is refused', () =>
    assertFails(createClassBatch(db('outsider'), 'outsider', { code: 'HJKLMN' }).commit()));

  await test('The default roles hold ANNOUNCEMENTS_MANAGE for the Mayor and the Secretary', async () => {
    const snap = await assertSucceeds(getDocs(collection(db('mayor'), `classes/${CLASS}/roles`)));
    const perms = Object.fromEntries(snap.docs.map((d) => [d.id, d.get('permissions')]));
    expect(perms.mayor.includes('ANNOUNCEMENTS_MANAGE') && perms.secretary.includes('ANNOUNCEMENTS_MANAGE'), 'missing ANNOUNCEMENTS_MANAGE');
  });

  // ---------------------------------------------------------------- Reading as an outsider

  await test('An outsider cannot read the class', () =>
    assertFails(getDoc(doc(db('outsider'), `classes/${CLASS}`))));

  await test('An outsider cannot read the members list', () =>
    assertFails(getDocs(collection(db('outsider'), `classes/${CLASS}/members`))));

  await test('Anyone signed in can look up one invite code', () =>
    assertSucceeds(getDoc(doc(db('student'), `invites/${CODE}`))));

  await test('Nobody can list all invite codes', () =>
    assertFails(getDocs(collection(db('student'), 'invites'))));

  await test('Anyone signed in can read the newest app version', () =>
    assertSucceeds(getDoc(doc(db('student'), 'appConfig/latest'))));

  await test('Someone not signed in cannot read the newest app version', () =>
    assertFails(getDoc(doc(anon(), 'appConfig/latest'))));

  await test('Nobody can publish an app version from the app', async () => {
    await assertFails(setDoc(doc(db('mayor'), 'appConfig/latest'), { versionCode: 99 }));
    await assertFails(deleteDoc(doc(db('mayor'), 'appConfig/latest')));
  });

  // ---------------------------------------------------------------- Joining: requests

  await test('A student can no longer add themselves to a class (joining needs approval)', async () => {
    const s = db('student');
    await assertFails(setDoc(doc(s, `classes/${CLASS}/members/student`), memberData('student')));
    // The v1 self-join, with the code in the member entry.
    await assertFails(setDoc(doc(s, `classes/${CLASS}/members/student`), { name: 'Student', roleId: 'member', joinedAtMillis: 2, excludedCourseIds: [], joinCode: CODE }));
  });

  await test('A join request needs a code that points to this class', async () => {
    await assertFails(requestJoin(db('student'), 'student', { code: 'WRONG1' }));
    await assertFails(requestJoin(db('student'), 'student', { code: OTHER_CODE }));
  });

  await test('Nobody can ask to join for someone else', async () => {
    await assertFails(requestJoin(db('student'), 'victim'));
    await assertFails(requestJoin(db('student'), 'student', { data: { uid: 'victim' } }));
  });

  await test('A join request has exactly its five fields with sensible values', async () => {
    const s = db('student');
    await assertFails(requestJoin(s, 'student', { data: { roleId: 'treasurer' } }));
    await assertFails(setDoc(doc(s, `classes/${CLASS}/joinRequests/student`), omit(joinRequestData('student'), 'className')));
    await assertFails(requestJoin(s, 'student', { data: { name: '  ' } }));
    await assertFails(requestJoin(s, 'student', { data: { name: 'x'.repeat(91) } }));
    await assertFails(requestJoin(s, 'student', { data: { className: 'x'.repeat(101) } }));
    await assertFails(requestJoin(s, 'student', { data: { requestedAtMillis: now() + HOUR } }));
    await assertFails(requestJoin(s, 'student', { data: { requestedAtMillis: String(now()) } }));
    await assertFails(requestJoin(s, 'student', { data: { id: 'student' } }));
  });

  await test('A student asks to join with the right code', () =>
    assertSucceeds(requestJoin(db('student'), 'student')));

  await test('Asking again while the request is waiting is refused (a request is never overwritten)', () =>
    assertFails(requestJoin(db('student'), 'student')));

  await test('More students ask to join', async () => {
    for (const u of ['maria', 'sec', 'clerk', 'pending', 'rejected', 'quitter']) await assertSucceeds(requestJoin(db(u), u));
  });

  await test('The requester reads their own request; another student cannot', async () => {
    await assertSucceeds(getDoc(doc(db('student'), `classes/${CLASS}/joinRequests/student`)));
    await assertFails(getDoc(doc(db('maria'), `classes/${CLASS}/joinRequests/student`)));
  });

  await test('The Mayor lists and reads join requests; a waiting student cannot list them', async () => {
    const snap = await assertSucceeds(getDocs(collection(db('mayor'), `classes/${CLASS}/joinRequests`)));
    expect(snap.size === 7, `expected 7 requests, got ${snap.size}`);
    await assertSucceeds(getDoc(doc(db('mayor'), `classes/${CLASS}/joinRequests/student`)));
    await assertFails(getDocs(collection(db('student'), `classes/${CLASS}/joinRequests`)));
  });

  await test('A waiting student cannot read anything inside the class', async () => {
    const s = db('student');
    await assertFails(getDoc(doc(s, `classes/${CLASS}`)));
    for (const c of ['members', 'roles', 'courses', 'records', 'charges', 'summary', 'schedule', 'contents', 'progress', 'openingBalances']) {
      await assertFails(getDocs(collection(s, `classes/${CLASS}/${c}`)));
    }
    await assertFails(getDocs(query(collection(s, `classes/${CLASS}/records`), where('memberId', '==', 'student'))));
    await assertFails(getDocs(query(collection(s, `classes/${CLASS}/records`), where('type', '==', 'EXPENSE'))));
    await assertFails(getDoc(doc(s, `classes/${CLASS}/summary/fund`)));
    await assertFails(getDoc(doc(s, `classPhotos/${CLASS}`)));
    const me = await assertSucceeds(getDoc(doc(s, `classes/${CLASS}/members/student`)));
    expect(!me.exists(), 'a waiting student has no member entry');
  });

  await test('"My classes": a waiting student finds their request with a collection-group query', async () => {
    const reqs = await assertSucceeds(myJoinRequests(db('student'), 'student'));
    expect(reqs.size === 1 && reqs.docs[0].ref.path === `classes/${CLASS}/joinRequests/student`, 'expected the one waiting request');
    const mine = await assertSucceeds(myMemberEntries(db('student'), 'student'));
    expect(mine.size === 0, 'a waiting student is in no class yet');
  });

  await test('"My classes": the Mayor finds their class with a collection-group query on members', async () => {
    const mine = await assertSucceeds(myMemberEntries(db('mayor'), 'mayor'));
    expect(mine.size === 1 && mine.docs[0].ref.path === `classes/${CLASS}/members/mayor`, 'expected the Mayor\'s one class');
  });

  await test('Nobody reads other people\'s entries with a collection-group query', async () => {
    const m = db('mayor');
    await assertFails(getDocs(collectionGroup(m, 'members')));
    await assertFails(getDocs(query(collectionGroup(m, 'members'), where('roleId', '==', 'mayor'))));
    await assertFails(myMemberEntries(m, 'owner2'));
    await assertFails(getDocs(collectionGroup(m, 'joinRequests')));
    await assertFails(myJoinRequests(m, 'student'));
    await assertFails(myJoinRequests(db('outsider'), 'student'));
  });

  await test('The collection-group rules do not open a class\'s members or requests to anyone else', async () => {
    const o = db('outsider');
    await assertFails(getDocs(query(collection(o, `classes/${CLASS}/members`), where('uid', '==', 'mayor'))));
    await assertFails(getDocs(query(collection(o, `classes/${CLASS}/joinRequests`), where('uid', '==', 'student'))));
    await assertFails(getDoc(doc(o, `classes/${CLASS}/members/mayor`)));
    await assertFails(getDoc(doc(o, `classes/${CLASS}/joinRequests/student`)));
  });

  // ---------------------------------------------------------------- Joining: approval

  await test('Approving cannot give a role other than the class default', async () => {
    const m = db('mayor');
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { roleId: 'treasurer' } }).commit());
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { roleId: 'mayor' } }).commit());
  });

  await test('Approving keeps the requested name, the student\'s uid and the approver\'s own uid', async () => {
    const m = db('mayor');
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { name: 'Someone Else' } }).commit());
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { uid: 'maria' } }).commit());
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { approvedByUid: 'clerk' } }).commit());
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { approvedByUid: '' } }).commit());
  });

  await test('Approving writes exactly the member fields: no extras, no courses left out, the current time', async () => {
    const m = db('mayor');
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { joinCode: CODE } }).commit());
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { excludedCourseIds: ['or'] } }).commit());
    await assertFails(approveBatch(m, 'mayor', 'student', { memberFields: { joinedAtMillis: now() - 2 * 24 * HOUR } }).commit());
  });

  await test('Approving must delete the request in the same batch', () =>
    assertFails(approveBatch(db('mayor'), 'mayor', 'student', { deleteRequest: false }).commit()));

  await test('Nobody can be approved without asking', async () => {
    await assertFails(approveBatch(db('mayor'), 'mayor', 'ghost').commit());
    await assertFails(approveBatch(db('mayor'), 'mayor', 'ghost', { deleteRequest: false }).commit());
  });

  await test('The Mayor approves the student: member entry created and request deleted in one batch', async () => {
    await assertSucceeds(approveBatch(db('mayor'), 'mayor', 'student').commit());
    const s = db('student');
    await assertSucceeds(getDoc(doc(s, `classes/${CLASS}`)));
    const req = await assertSucceeds(getDoc(doc(s, `classes/${CLASS}/joinRequests/student`)));
    expect(!req.exists(), 'the request should be gone');
  });

  await test('"My classes": the approved student finds the class and no waiting request', async () => {
    const mine = await assertSucceeds(myMemberEntries(db('student'), 'student'));
    expect(mine.size === 1 && mine.docs[0].get('uid') === 'student', 'expected one class');
    const reqs = await assertSucceeds(myJoinRequests(db('student'), 'student'));
    expect(reqs.size === 0, 'expected no waiting request');
  });

  await test('A member cannot ask to join the same class again', () =>
    assertFails(requestJoin(db('student'), 'student')));

  await test('A member can read the class, members and roles', async () => {
    const store = db('student');
    await assertSucceeds(getDoc(doc(store, `classes/${CLASS}`)));
    await assertSucceeds(getDocs(collection(store, `classes/${CLASS}/members`)));
    await assertSucceeds(getDocs(collection(store, `classes/${CLASS}/roles`)));
  });

  await test('A plain member cannot read, approve or reject join requests', async () => {
    const s = db('student');
    await assertFails(getDocs(collection(s, `classes/${CLASS}/joinRequests`)));
    await assertFails(getDoc(doc(s, `classes/${CLASS}/joinRequests/maria`)));
    await assertFails(approveBatch(s, 'student', 'maria').commit());
    await assertFails(deleteDoc(doc(s, `classes/${CLASS}/joinRequests/maria`)));
  });

  await test('The Mayor approves Maria, the Secretary and the clerk', async () => {
    for (const u of ['maria', 'sec', 'clerk']) await assertSucceeds(approveBatch(db('mayor'), 'mayor', u).commit());
  });

  // ---------------------------------------------------------------- Roles and members

  await test('A Member cannot promote themselves', () =>
    assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { roleId: 'treasurer' })));

  await test('A Member cannot edit roles', () =>
    assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/roles/member`), { permissions: PERMS })));

  await test('The Mayor makes Maria the Treasurer and Sec the Secretary', async () => {
    await assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/maria`), { roleId: 'treasurer' }));
    await assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/sec`), { roleId: 'secretary' }));
  });

  await test('Nobody can be given the locked Mayor role', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { roleId: 'mayor' })));

  await test('The Mayor cannot change their own role', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/mayor`), { roleId: 'member' })));

  await test('The locked Mayor role cannot be edited, even by the Mayor', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/roles/mayor`), { name: 'King' })));

  await test('The Mayor changes the color of the locked Mayor role, and nothing else on it; nobody else does', async () => {
    const mayorRole = (who) => doc(db(who), `classes/${CLASS}/roles/mayor`);
    await assertSucceeds(updateDoc(mayorRole('mayor'), { colorHex: '#BE123C' }));
    await assertFails(updateDoc(mayorRole('mayor'), { colorHex: 'red' }));
    await assertFails(updateDoc(mayorRole('mayor'), { colorHex: '#BE123C', name: 'King' }));
    await assertFails(updateDoc(mayorRole('mayor'), { colorHex: '#BE123C', locked: false }));
    await assertFails(updateDoc(mayorRole('mayor'), { permissions: [] }));
    await assertFails(updateDoc(mayorRole('student'), { colorHex: '#000000' }));
    await assertFails(updateDoc(mayorRole('outsider'), { colorHex: '#000000' }));
  });

  await test('A new role cannot be created as locked', () =>
    assertFails(setDoc(doc(db('mayor'), `classes/${CLASS}/roles/fake`), { id: '', name: 'Fake', colorHex: '#000000', permissions: PERMS, locked: true })));

  await test('The Mayor creates a Clerk role (class settings and members) and gives it to the clerk', async () => {
    const store = db('mayor');
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/roles/clerk`), { id: '', name: 'Clerk', colorHex: '#0E7490', permissions: ['CLASS_SETTINGS', 'MEMBERS_MANAGE'], locked: false }));
    await assertSucceeds(updateDoc(doc(store, `classes/${CLASS}/members/clerk`), { roleId: 'clerk' }));
  });

  await test('The Mayor creates a custom PIO role and gives it to the student', async () => {
    const store = db('mayor');
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/roles/pio`), { id: '', name: 'PIO', colorHex: '#BE123C', permissions: ['SCHEDULE_MANAGE'], locked: false }));
    await assertSucceeds(updateDoc(doc(store, `classes/${CLASS}/members/student`), { roleId: 'pio' }));
  });

  await test('Deleting the PIO role moves its holders to Member in one batch', async () => {
    const store = db('mayor');
    const b = writeBatch(store);
    b.update(doc(store, `classes/${CLASS}/members/student`), { roleId: 'member' });
    b.delete(doc(store, `classes/${CLASS}/roles/pio`));
    await assertSucceeds(b.commit());
  });

  await test('Someone who manages roles cannot edit the role they hold, but can edit the others', async () => {
    const mayor = db('mayor');
    await assertSucceeds(setDoc(doc(mayor, `classes/${CLASS}/roles/vice`), { id: '', name: 'Vice', colorHex: '#1D4ED8', permissions: ['ROLES_MANAGE'], locked: false }));
    await assertSucceeds(updateDoc(doc(mayor, `classes/${CLASS}/members/student`), { roleId: 'vice' }));
    const vice = db('student');
    await assertFails(updateDoc(doc(vice, `classes/${CLASS}/roles/vice`), { permissions: PERMS }));
    await assertFails(updateDoc(doc(vice, `classes/${CLASS}/roles/vice`), { name: 'Boss' }));
    // The same person may still edit a role they do not hold, and the Mayor may edit theirs.
    await assertSucceeds(updateDoc(doc(vice, `classes/${CLASS}/roles/clerk`), { colorHex: '#0E7491' }));
    await assertSucceeds(updateDoc(doc(vice, `classes/${CLASS}/roles/clerk`), { colorHex: '#0E7490' }));
    await assertSucceeds(updateDoc(doc(mayor, `classes/${CLASS}/roles/vice`), { name: 'Vice Mayor' }));
    // Put things back: the role goes and the student is a plain member again.
    const b = writeBatch(mayor);
    b.update(doc(mayor, `classes/${CLASS}/members/student`), { roleId: 'member' });
    b.delete(doc(mayor, `classes/${CLASS}/roles/vice`));
    await assertSucceeds(b.commit());
  });

  await test('Class settings keep their types when they are changed', async () => {
    const ref = doc(db('mayor'), `classes/${CLASS}`);
    await assertFails(updateDoc(ref, { name: 123 }));
    await assertFails(updateDoc(ref, { name: '' }));
    await assertFails(updateDoc(ref, { contentsEnabled: 'no' }));
    await assertFails(updateDoc(ref, { accentColor: 'x'.repeat(10) }));
    await assertFails(updateDoc(ref, { inviteCode: 'bad code!' }));
    await assertSucceeds(updateDoc(ref, { description: 'Section A' }));
    await assertSucceeds(updateDoc(ref, { description: '' }));
  });

  await test('The default Member role cannot be deleted', () =>
    assertFails(deleteDoc(doc(db('mayor'), `classes/${CLASS}/roles/member`))));

  await test('A Treasurer cannot change anyone\'s role', () =>
    assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}/members/student`), { roleId: 'secretary' })));

  await test('The Mayor sets which courses a student takes', () =>
    assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { excludedCourseIds: ['or'] })));

  await test('A member\'s uid and approver never change', async () => {
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { name: 'Student Two', uid: 'someone' }));
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { uid: 'someone' }));
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { approvedByUid: 'clerk' }));
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { roleId: 'treasurer', uid: 'maria' }));
    await assertSucceeds(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { name: 'Student Two' }));
  });

  await test('Attendance: officers save sheets with or without excused; a student reads only sheets that name them', async () => {
    const A = `classes/${CLASS}/attendance`;
    const sheet = (extra = {}) => ({ dateKey: '2026-11-16', meetingId: 'meet1', courseId: 'or', absent: [], late: [], excused: ['student'], takenByUid: 'mayor', takenAtMillis: Date.now(), ...extra });
    await assertSucceeds(setDoc(doc(db('mayor'), `${A}/2026-11-16_meet1`), sheet()));
    await assertSucceeds(setDoc(doc(db('mayor'), `${A}/2026-11-09_meet1`), omit(sheet({ dateKey: '2026-11-09', excused: [], absent: ['maria'] }), 'excused')));
    await assertFails(setDoc(doc(db('mayor'), `${A}/2026-11-02_meet1`), sheet({ dateKey: '2026-11-02', excused: 'student' })));
    await assertFails(setDoc(doc(db('mayor'), `${A}/2026-11-02_meet1`), sheet({ dateKey: '2026-11-02', reason: 'sick' })));
    await assertFails(setDoc(doc(db('student'), `${A}/2026-11-02_meet1`), sheet({ dateKey: '2026-11-02', takenByUid: 'student' })));
    // The student's "My attendance" query for excused days, and a classmate who is not on the sheet.
    await assertSucceeds(getDocs(query(collection(db('student'), A), where('excused', 'array-contains', 'student'))));
    await assertSucceeds(getDoc(doc(db('student'), `${A}/2026-11-16_meet1`)));
    await assertFails(getDoc(doc(db('maria'), `${A}/2026-11-16_meet1`)));
    await assertSucceeds(getDoc(doc(db('maria'), `${A}/2026-11-09_meet1`)));
  });

  await test('Notification requests: each kind only from someone who can cause it; nobody reads the queue', async () => {
    const notice = (who, fields) => setDoc(doc(db(who), `classes/${CLASS}/outbox/n-${who}-${fields.kind}-${Math.random().toString(36).slice(2)}`),
      { audience: 'CLASS', audienceId: '', title: 'Hello', body: '', createdByUid: who, createdAtMillis: Date.now(), ...fields });
    await assertSucceeds(notice('mayor', { kind: 'ANNOUNCEMENT' }));
    await assertSucceeds(notice('mayor', { kind: 'SCHEDULE_NEW', audience: 'COURSE', audienceId: 'or' }));
    await assertSucceeds(notice('student', { kind: 'CLAIM_SENT', audience: 'PERMISSION', audienceId: 'RECORDS_MANAGE' }));
    await assertSucceeds(notice('mayor', { kind: 'CLAIM_DECIDED', audience: 'USER', audienceId: 'student' }));
    await assertSucceeds(notice('mayor', { kind: 'PAYMENT_DUE', audience: 'USER', audienceId: 'student' }));
    await assertFails(notice('student', { kind: 'PAYMENT_DUE', audience: 'USER', audienceId: 'mayor' }));
    await assertFails(notice('mayor', { kind: 'PAYMENT_DUE', audience: 'CLASS' }));
    await assertFails(notice('student', { kind: 'ANNOUNCEMENT' }));
    await assertFails(notice('student', { kind: 'NO_CLASS' }));
    await assertFails(notice('student', { kind: 'CLAIM_DECIDED', audience: 'USER', audienceId: 'mayor' }));
    await assertFails(notice('student', { kind: 'CLAIM_SENT', audience: 'CLASS' }));
    await assertFails(notice('mayor', { kind: 'ANNOUNCEMENT', title: '' }));
    await assertFails(notice('mayor', { kind: 'ANNOUNCEMENT', createdByUid: 'student' }));
    await assertFails(notice('mayor', { kind: 'ANNOUNCEMENT', extra: 1 }));
    await assertFails(notice('outsider', { kind: 'CLAIM_SENT', audience: 'PERMISSION', audienceId: 'RECORDS_MANAGE' }));
    await assertFails(getDocs(collection(db('mayor'), `classes/${CLASS}/outbox`)));
  });

  await test('History log: officers add entries under their own uid in the same batch; append-only; read with class settings', async () => {
    const H = `classes/${CLASS}/history`;
    const entry = (who, extra = {}) => ({ kind: 'PAYMENT', text: 'Recorded a payment of ₱100.00 from Student', actorUid: who, actorName: nameOf(who), atMillis: Date.now(), ...extra });
    const add = (who, extra) => setDoc(doc(collection(db(who), H)), entry(who, extra));
    // The Treasurer's payment and its entry, in one batch.
    const m = db('maria');
    const { b } = addRecordBatch(m, payment('maria', 'student'));
    b.set(doc(collection(m, H), 'h-pay'), entry('maria'));
    await assertSucceeds(b.commit());
    await assertSucceeds(add('mayor', { kind: 'MEMBER_ROLE', text: 'Gave Student the Treasurer role' }));
    await assertSucceeds(add('mayor', { kind: 'REMINDERS', text: 'Sent payment reminders to 1 student: Student (₱50.00)' }));
    // Announcement edits and deletes: anyone who manages announcements, and only those kinds for them.
    await assertSucceeds(add('mayor', { kind: 'ANNOUNCEMENT_DELETED', text: 'Deleted the announcement "Civilian attire"' }));
    await assertSucceeds(add('sec', { kind: 'ANNOUNCEMENT_DELETED', text: 'Deleted the announcement "Civilian attire"' }));
    await assertSucceeds(add('sec', { kind: 'ANNOUNCEMENT_EDITED', text: 'Edited the announcement "Civilian attire"' }));
    await assertFails(add('sec', { kind: 'PAYMENT' }));
    await assertFails(add('maria', { kind: 'ANNOUNCEMENT_DELETED', text: 'Deleted the announcement "Civilian attire"' }));
    await assertFails(add('student', { kind: 'ANNOUNCEMENT_DELETED', text: 'Deleted the announcement "Civilian attire"' }));
    await assertFails(add('student'));
    await assertFails(add('outsider'));
    await assertFails(setDoc(doc(collection(db('maria'), H)), entry('mayor')));
    await assertFails(add('maria', { kind: 'NOT_A_KIND' }));
    await assertFails(add('maria', { text: '' }));
    await assertFails(add('maria', { text: 'x'.repeat(301) }));
    await assertFails(add('maria', { atMillis: Date.now() - 2 * 86400000 }));
    await assertFails(add('maria', { extra: 1 }));
    await assertSucceeds(getDocs(collection(db('mayor'), H)));
    await assertFails(getDocs(collection(db('maria'), H)));
    await assertFails(getDocs(collection(db('student'), H)));
    await assertFails(updateDoc(doc(db('mayor'), `${H}/h-pay`), { text: 'Nothing happened' }));
    await assertFails(deleteDoc(doc(db('mayor'), `${H}/h-pay`)));

    // Nov 22 kinds: each only with the permission behind the action (sec: schedule, contents, news, attendance;
    // maria: ledger only; clerk: settings and members).
    for (const kind of ['ATTENDANCE_TAKEN', 'ATTENDANCE_REPLACED', 'ATTENDANCE_REMOVED', 'NO_CLASS_MARKED', 'NO_CLASS_REMOVED',
      'MEETING_ADDED', 'MEETING_EDITED', 'MEETING_DELETED', 'SCHEDULE_EDITED', 'SCHEDULE_DELETED', 'CONTENT_EDITED', 'CONTENT_DELETED',
      'ANNOUNCEMENT_POSTED', 'ANNOUNCEMENT_PINNED', 'COMMENT_REMOVED', 'FORUM_MODERATED', 'FORUM_QUESTION_DELETED', 'FORUM_ANSWER_REMOVED']) {
      await assertSucceeds(add('sec', { kind, text: `Did ${kind}` }));
      await assertSucceeds(add('mayor', { kind, text: `Did ${kind}` }));
      await assertFails(add('maria', { kind, text: `Did ${kind}` }));
      await assertFails(add('clerk', { kind, text: `Did ${kind}` }));
      await assertFails(add('student', { kind, text: `Did ${kind}` }));
    }
    for (const kind of ['COURSE_ADDED', 'COURSE_EDITED', 'COURSE_DELETED']) {
      await assertSucceeds(add('clerk', { kind, text: `Did ${kind}` }));
      await assertFails(add('sec', { kind, text: `Did ${kind}` }));
      await assertFails(add('student', { kind, text: `Did ${kind}` }));
    }
    // Leaving: only in the batch that deletes the member's own entry, never as a free-standing entry.
    await assertFails(add('student', { kind: 'MEMBER_LEFT', text: 'Left the class' }));
    await assertFails(add('mayor', { kind: 'MEMBER_LEFT', text: 'Left the class' }));
    await admin(async (a) => {
      const student = (await getDoc(doc(a, `classes/${CLASS}/members/student`))).data();
      await setDoc(doc(a, `classes/${CLASS}/members/leaver`), { ...student, name: 'Leaving Student' });
    });
    const leaver = db('leaver');
    const leave = writeBatch(leaver);
    leave.delete(doc(leaver, `classes/${CLASS}/members/leaver`));
    leave.set(doc(collection(leaver, H)), { kind: 'MEMBER_LEFT', text: 'Left the class', actorUid: 'leaver', actorName: 'Leaving Student', atMillis: Date.now() });
    await assertSucceeds(leave.commit());
  });

  await test('Comments: members comment under their own name, one level of replies, count kept by the same batch', async () => {
    const P = `classes/${CLASS}/announcements`;
    const C = `classes/${CLASS}/comments`;
    const now = Date.now();
    const post = { title: 'Quiz moved', body: '', pinned: false, createdByUid: 'mayor', createdAtMillis: now, editedAtMillis: 0 };
    await assertSucceeds(setDoc(doc(db('mayor'), `${P}/p1`), post));
    await assertFails(setDoc(doc(db('mayor'), `${P}/p9`), { ...post, commentCount: 5 }));
    const read = async (path) => {
      let data;
      await admin(async (a) => (data = (await getDoc(doc(a, path))).data()));
      return data;
    };
    const nameOf = async (who) => (await read(`classes/${CLASS}/members/${who}`)).name;
    const names = { student: await nameOf('student'), mayor: await nameOf('mayor') };
    const add = (who, id, fields = {}, bump = {}) => {
      const d = db(who);
      const b = writeBatch(d);
      b.set(doc(d, `${C}/${id}`), { postId: 'p1', parentId: '', uid: who, name: names[who], text: 'Hello', createdAtMillis: Date.now(), removedAtMillis: 0, ...fields });
      b.update(doc(d, `${P}/p1`), { commentCount: increment(1), lastCommentId: id, ...bump });
      return b.commit();
    };
    await assertSucceeds(add('student', 'c1'));
    await assertSucceeds(add('mayor', 'r1', { parentId: 'c1' }));
    expect((await read(`${P}/p1`)).commentCount === 2, 'the count should be 2');
    await assertFails(add('student', 'c2', { name: 'Mayor' }));
    await assertFails(add('student', 'c2', { uid: 'mayor' }));
    await assertFails(add('student', 'c2', { text: '  ' }));
    await assertFails(add('student', 'c2', { text: 'x'.repeat(501) }));
    await assertFails(add('student', 'c2', { removedAtMillis: 5 }));
    await assertFails(add('student', 'c2', { extra: 1 }));
    await assertFails(add('student', 'c2', { parentId: 'r1' }));
    await assertFails(add('student', 'c2', { parentId: 'nothing' }));
    await assertFails(add('student', 'c2', {}, { commentCount: increment(2) }));
    await assertFails(add('student', 'c2', {}, { title: 'Hacked' }));
    await assertFails(add('student', 'c2', {}, { lastCommentId: 'c1' }));
    // Not without the count, and no count without a new comment.
    await assertFails(setDoc(doc(db('student'), `${C}/c3`), { postId: 'p1', parentId: '', uid: 'student', name: names.student, text: 'Hi', createdAtMillis: Date.now(), removedAtMillis: 0 }));
    await assertFails(updateDoc(doc(db('student'), `${P}/p1`), { commentCount: increment(1), lastCommentId: 'c1' }));
    await assertFails(updateDoc(doc(db('student'), `${P}/p1`), { commentCount: increment(1), lastCommentId: 'ghost' }));
    await assertFails(updateDoc(doc(db('student'), `${P}/p1`), { pinned: true }));
    // An officer edits the announcement but not its count.
    await assertSucceeds(updateDoc(doc(db('mayor'), `${P}/p1`), { title: 'Quiz moved to Friday', editedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('mayor'), `${P}/p1`), { commentCount: 0 }));
    // Outsiders see and write nothing.
    await assertFails(getDoc(doc(db('outsider'), `${C}/c1`)));
    await assertSucceeds(getDocs(query(collection(db('student'), C), where('postId', '==', 'p1'))));
    // Removing: the writer or an announcements officer, once, text blanked; never an edit.
    await assertFails(updateDoc(doc(db('student'), `${C}/c1`), { text: 'Edited' }));
    await assertFails(updateDoc(doc(db('student'), `${C}/r1`), { text: '', removedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('student'), `${C}/c1`), { text: '', removedAtMillis: Date.now(), name: 'X' }));
    await assertSucceeds(updateDoc(doc(db('student'), `${C}/c1`), { text: '', removedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('student'), `${C}/c1`), { text: '', removedAtMillis: Date.now() }));
    await assertSucceeds(updateDoc(doc(db('mayor'), `${C}/r1`), { text: '', removedAtMillis: Date.now() }));
    await assertFails(deleteDoc(doc(db('student'), `${C}/c1`)));
    // Comments switched off.
    await assertSucceeds(updateDoc(doc(db('mayor'), `${P}/p1`), { commentsOff: true }));
    await assertFails(add('student', 'c4'));
    await assertSucceeds(updateDoc(doc(db('mayor'), `${P}/p1`), { commentsOff: false }));
    await assertSucceeds(add('student', 'c4'));
    // The notice for a comment.
    const notice = (who, fields) => setDoc(doc(db(who), `classes/${CLASS}/outbox/n-${who}-${Math.random().toString(36).slice(2)}`),
      { kind: 'COMMENT', audience: 'USER', audienceId: 'mayor', title: 'Hello', body: '', createdByUid: who, createdAtMillis: Date.now(), ...fields });
    await assertSucceeds(notice('student', {}));
    await assertFails(notice('student', { audience: 'CLASS' }));
    await assertFails(notice('outsider', {}));
    await assertSucceeds(deleteDoc(doc(db('mayor'), `${C}/c4`)));
    await assertSucceeds(deleteDoc(doc(db('mayor'), `${C}/c1`)));
    await assertSucceeds(deleteDoc(doc(db('mayor'), `${C}/r1`)));
    await assertSucceeds(deleteDoc(doc(db('mayor'), `${P}/p1`)));
  });

  // ---------------------------------------------------------------- Forum (docs/PLAN-FORUM.md)
  // student asks, maria (Treasurer, no News permission) answers, sec (Secretary) moderates.

  const F = `classes/${CLASS}/forum`;
  const FA = `classes/${CLASS}/forumAnswers`;
  const FW = `classes/${CLASS}/forumAuthors`;
  const readAs = async (path) => {
    let data;
    await admin(async (a) => (data = (await getDoc(doc(a, path))).data()));
    return data;
  };
  const memberName = async (who) => (await readAs(`classes/${CLASS}/members/${who}`))?.name ?? nameOf(who);
  const question = (fields = {}) => ({
    title: 'Is the quiz open notes?', body: '', courseId: '', anonymous: false, uid: '', name: '', createdAtMillis: Date.now(), editedAtMillis: 0,
    answerCount: 0, lastAnswerId: '', bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0, closed: false, hidden: false, ...fields,
  });
  /** Asks a question the way the app does: the question and its author record in one batch. */
  const ask = async (who, id, fields = {}, record = {}) => {
    const d = db(who);
    const anonymous = fields.anonymous === true;
    const b = writeBatch(d);
    b.set(doc(d, `${F}/${id}`), question({ uid: anonymous ? '' : who, name: anonymous ? '' : await memberName(who), ...fields }));
    if (record !== null) b.set(doc(d, `${FW}/${id}`), { uid: who, questionId: id, ...record });
    return b.commit();
  };
  /** Answers or replies: the answer, its author record and the question's count, in one batch. */
  const answer = async (who, id, qid, fields = {}, { bump = {}, record = {} } = {}) => {
    const d = db(who);
    const anonymous = fields.anonymous === true;
    const b = writeBatch(d);
    b.set(doc(d, `${FA}/${id}`), {
      questionId: qid, parentId: '', uid: anonymous ? '' : who, name: anonymous ? '' : await memberName(who), anonymous, text: 'Open notes, no laptops.',
      createdAtMillis: Date.now(), removedAtMillis: 0, ...fields,
    });
    if (record !== null) b.set(doc(d, `${FW}/${id}`), { uid: who, questionId: qid, ...record });
    b.update(doc(d, `${F}/${qid}`), { answerCount: increment(1), lastAnswerId: id, ...bump });
    return b.commit();
  };
  const pick = (who, qid, aid, auid, by, fields = {}) =>
    updateDoc(doc(db(who), `${F}/${qid}`), { bestAnswerId: aid, bestAnswerUid: auid, pickedBy: by, pickedAtMillis: Date.now(), ...fields });

  await test('Forum: any member asks under their own name or anonymously, always with an author record', async () => {
    await assertFails(ask('student', 'q0', {}, null));
    await assertFails(ask('student', 'q0', {}, { uid: 'maria' }));
    await assertFails(ask('student', 'q0', { uid: 'maria' }));
    await assertFails(ask('student', 'q0', { name: 'Someone Else' }));
    await assertFails(ask('student', 'q0', { anonymous: true, uid: 'student' }));
    await assertFails(ask('student', 'q0', { anonymous: true, name: 'Student' }));
    await assertFails(ask('student', 'q0', { title: '   ' }));
    await assertFails(ask('student', 'q0', { title: 'x'.repeat(151) }));
    await assertFails(ask('student', 'q0', { body: 'x'.repeat(2001) }));
    await assertFails(ask('student', 'q0', { answerCount: 3 }));
    await assertFails(ask('student', 'q0', { closed: true }));
    await assertFails(ask('student', 'q0', { hidden: true }));
    await assertFails(ask('student', 'q0', { pickedBy: 'ASKER' }));
    await assertFails(ask('student', 'q0', { extra: 1 }));
    await assertFails(ask('outsider', 'q0'));
    await assertSucceeds(ask('student', 'q1', { courseId: 'or' }));
    await assertSucceeds(ask('student', 'q2', { anonymous: true }));
    // A record cannot be written for someone else's question, or for one that already exists.
    await assertFails(setDoc(doc(db('maria'), `${FW}/q1`), { uid: 'maria', questionId: 'q1' }));
  });

  await test('Forum: an anonymous question hides its asker from classmates, not from News officers', async () => {
    const q2 = await assertSucceeds(getDoc(doc(db('maria'), `${F}/q2`)));
    expect(q2.get('uid') === '' && q2.get('name') === '', 'the question itself must not name the asker');
    await assertFails(getDoc(doc(db('maria'), `${FW}/q2`)));
    await assertFails(getDocs(collection(db('maria'), FW)));
    await assertSucceeds(getDoc(doc(db('student'), `${FW}/q2`)));
    await assertSucceeds(getDoc(doc(db('sec'), `${FW}/q2`)));
    await assertSucceeds(getDocs(collection(db('sec'), FW)));
  });

  await test('Forum: answers and replies, one level, count kept by the same batch; only the asker answers anonymously', async () => {
    await assertSucceeds(answer('maria', 'a1', 'q1'));
    await assertSucceeds(answer('mayor', 'a2', 'q1', { text: 'Closed notes I think.' }));
    await assertSucceeds(answer('student', 'r1', 'q1', { parentId: 'a1', text: 'Thanks! Even a calculator?' }));
    expect((await readAs(`${F}/q1`)).answerCount === 3, 'the count should be 3');
    await assertFails(answer('maria', 'r2', 'q1', { parentId: 'r1' }));
    await assertFails(answer('maria', 'r2', 'q1', { parentId: 'nothing' }));
    await assertFails(answer('maria', 'x1', 'q1', { uid: 'student' }));
    await assertFails(answer('maria', 'x1', 'q1', { name: 'Student' }));
    await assertFails(answer('maria', 'x1', 'q1', { text: ' ' }));
    await assertFails(answer('maria', 'x1', 'q1', { text: 'x'.repeat(1001) }));
    await assertFails(answer('maria', 'x1', 'q1', { removedAtMillis: 5 }));
    await assertFails(answer('maria', 'x1', 'q1', {}, { record: null }));
    await assertFails(answer('maria', 'x1', 'q1', {}, { record: { uid: 'student' } }));
    await assertFails(answer('maria', 'x1', 'q1', {}, { record: { questionId: 'q2' } }));
    await assertFails(answer('maria', 'x1', 'q1', {}, { bump: { answerCount: increment(2) } }));
    await assertFails(answer('maria', 'x1', 'q1', {}, { bump: { title: 'Hacked' } }));
    // Anonymous: only the asker, only on their own question.
    await assertFails(answer('maria', 'x1', 'q2', { anonymous: true }));
    await assertFails(answer('mayor', 'x1', 'q1', { anonymous: true }));
    await assertSucceeds(answer('maria', 'a3', 'q2'));
    await assertSucceeds(answer('student', 'r3', 'q2', { anonymous: true, parentId: 'a3', text: 'Which folder?' }));
    const r3 = await assertSucceeds(getDoc(doc(db('maria'), `${FA}/r3`)));
    expect(r3.get('uid') === '' && r3.get('name') === '', 'the anonymous reply must not name the asker');
    // No count without an answer, and no answer without the count.
    await assertFails(updateDoc(doc(db('maria'), `${F}/q1`), { answerCount: increment(1), lastAnswerId: 'a1' }));
    await assertFails(setDoc(doc(db('maria'), `${FA}/x2`), {
      questionId: 'q1', parentId: '', uid: 'maria', name: await memberName('maria'), anonymous: false, text: 'Hi', createdAtMillis: Date.now(), removedAtMillis: 0,
    }));
    await assertFails(getDoc(doc(db('outsider'), `${FA}/a1`)));
    await assertSucceeds(getDocs(query(collection(db('student'), FA), where('questionId', '==', 'q1'))));
  });

  await test('Forum: the asker or a News officer picks the best answer; never their own, a reply or someone else\'s pick', async () => {
    await assertFails(pick('maria', 'q1', 'a1', 'maria', 'ASKER'));
    await assertFails(pick('maria', 'q1', 'a1', 'maria', 'OFFICER'));
    await assertFails(pick('student', 'q1', 'a1', 'mayor', 'ASKER'));
    await assertFails(pick('student', 'q1', 'a1', 'maria', 'OFFICER'));
    await assertFails(pick('student', 'q1', 'r1', 'student', 'ASKER'));
    await assertFails(pick('student', 'q1', 'a3', 'maria', 'ASKER'));
    await assertFails(pick('student', 'q1', 'a1', 'maria', 'ASKER', { title: 'Changed' }));
    await assertSucceeds(pick('student', 'q1', 'a1', 'maria', 'ASKER'));
    await assertSucceeds(pick('sec', 'q1', 'a2', 'mayor', 'OFFICER'));
    await assertFails(pick('sec', 'q1', 'a1', 'maria', 'ASKER'));
    await assertSucceeds(updateDoc(doc(db('student'), `${F}/q1`), { bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0 }));
    // An anonymous asker picks too, recorded as the asker.
    await assertSucceeds(pick('student', 'q2', 'a3', 'maria', 'ASKER'));
    // The asker's own anonymous reply cannot be picked, even by an officer.
    await assertFails(pick('sec', 'q2', 'r3', '', 'OFFICER'));
  });

  await test('Forum: the asker edits their question; writers and officers remove answers; a removed best answer is cleared', async () => {
    await assertSucceeds(updateDoc(doc(db('student'), `${F}/q1`), { title: 'Is Friday\'s quiz open notes?', courseId: 'se', editedAtMillis: Date.now() }));
    await assertSucceeds(updateDoc(doc(db('student'), `${F}/q2`), { body: 'For the SE chapter 3.', editedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('maria'), `${F}/q1`), { title: 'Hacked', editedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('student'), `${F}/q1`), { anonymous: true, uid: '', name: '' }));
    await assertFails(updateDoc(doc(db('student'), `${F}/q1`), { answerCount: 0 }));
    await assertFails(updateDoc(doc(db('maria'), `${FA}/a1`), { text: 'Edited' }));
    await assertFails(updateDoc(doc(db('student'), `${FA}/a1`), { text: '', removedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('maria'), `${F}/q2`), { bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0 }));
    await assertSucceeds(updateDoc(doc(db('maria'), `${FA}/a3`), { text: '', removedAtMillis: Date.now() }));
    await assertSucceeds(updateDoc(doc(db('maria'), `${F}/q2`), { bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0 }));
    await assertSucceeds(updateDoc(doc(db('student'), `${FA}/r3`), { text: '', removedAtMillis: Date.now() }));
    await assertSucceeds(updateDoc(doc(db('sec'), `${FA}/a2`), { text: '', removedAtMillis: Date.now() }));
    await assertFails(updateDoc(doc(db('sec'), `${FA}/a2`), { text: '', removedAtMillis: Date.now() }));
  });

  await test('Forum: News officers close and hide; hidden questions are read only by them', async () => {
    await assertFails(updateDoc(doc(db('maria'), `${F}/q1`), { closed: true }));
    await assertFails(updateDoc(doc(db('student'), `${F}/q1`), { hidden: true }));
    await assertSucceeds(updateDoc(doc(db('sec'), `${F}/q1`), { closed: true }));
    await assertFails(answer('maria', 'x3', 'q1'));
    await assertFails(pick('student', 'q1', 'a1', 'maria', 'ASKER'));
    await assertSucceeds(updateDoc(doc(db('sec'), `${F}/q1`), { closed: false, hidden: true }));
    await assertFails(getDoc(doc(db('maria'), `${F}/q1`)));
    await assertFails(getDocs(collection(db('maria'), F)));
    await assertSucceeds(getDocs(query(collection(db('maria'), F), where('hidden', '==', false))));
    await assertSucceeds(getDocs(collection(db('sec'), F)));
    await assertFails(answer('maria', 'x3', 'q1'));
    await assertSucceeds(updateDoc(doc(db('sec'), `${F}/q1`), { hidden: false }));
  });

  await test('Forum: the asker deletes their question; what it leaves behind may be cleared', async () => {
    await assertFails(deleteDoc(doc(db('maria'), `${F}/q2`)));
    await assertFails(deleteDoc(doc(db('maria'), `${FA}/a3`)));
    const s = db('student');
    const b = writeBatch(s);
    b.delete(doc(s, `${F}/q2`));
    b.delete(doc(s, `${FW}/q2`));
    await assertSucceeds(b.commit());
    await assertSucceeds(deleteDoc(doc(db('maria'), `${FA}/a3`)));
    await assertSucceeds(deleteDoc(doc(db('student'), `${FA}/r3`)));
    await assertSucceeds(deleteDoc(doc(db('student'), `${FW}/a3`)));
    await assertSucceeds(deleteDoc(doc(db('student'), `${FW}/r3`)));
    // A live question's answers and records stay.
    await assertFails(deleteDoc(doc(db('student'), `${FA}/a1`)));
    await assertFails(deleteDoc(doc(db('student'), `${FW}/a1`)));
    await assertSucceeds(deleteDoc(doc(db('sec'), `${F}/q1`)));
  });

  await test('Forum and tags: notices, tagged announcements, the forum visit time', async () => {
    const notice = (who, fields) => setDoc(doc(db(who), `classes/${CLASS}/outbox/f-${who}-${Math.random().toString(36).slice(2)}`),
      { kind: 'FORUM_QUESTION', audience: 'CLASS', audienceId: '', title: 'New question', body: '', createdByUid: who, createdAtMillis: Date.now(), ...fields });
    await assertSucceeds(notice('student', {}));
    await assertSucceeds(notice('student', { audience: 'COURSE', audienceId: 'or' }));
    await assertSucceeds(notice('student', { kind: 'FORUM_ANSWER', audience: 'AUTHOR', audienceId: 'q1' }));
    await assertFails(notice('student', { kind: 'FORUM_ANSWER', audience: 'CLASS' }));
    await assertFails(notice('student', { audience: 'PERMISSION', audienceId: 'RECORDS_MANAGE' }));
    await assertFails(notice('outsider', {}));
    await assertSucceeds(notice('sec', { kind: 'ANNOUNCEMENT', audience: 'COURSE', audienceId: 'or' }));
    await assertFails(notice('student', { kind: 'ANNOUNCEMENT', audience: 'COURSE', audienceId: 'or' }));
    const P = `classes/${CLASS}/announcements`;
    const post = { title: 'OR quiz moved', body: '', pinned: false, createdByUid: 'sec', createdAtMillis: Date.now(), editedAtMillis: 0 };
    await assertSucceeds(setDoc(doc(db('sec'), `${P}/tag1`), { ...post, courseId: 'or' }));
    await assertFails(setDoc(doc(db('sec'), `${P}/tag2`), { ...post, courseId: 5 }));
    await assertSucceeds(updateDoc(doc(db('sec'), `${P}/tag1`), { courseId: '', editedAtMillis: Date.now() }));
    await assertSucceeds(deleteDoc(doc(db('sec'), `${P}/tag1`)));
    const S = `classes/${CLASS}/seen/student`;
    await assertSucceeds(setDoc(doc(db('student'), S), { forumAt: Date.now(), hideFromBoard: true }, { merge: true }));
    await assertFails(setDoc(doc(db('student'), S), { forumAt: 'today' }, { merge: true }));
    await assertFails(setDoc(doc(db('student'), S), { hideFromBoard: 'yes' }, { merge: true }));
    await assertFails(setDoc(doc(db('maria'), S), { hideFromBoard: false }, { merge: true }));
  });

  await test('Votes: one document per member, written only by them, read by the class', async () => {
    const V = `classes/${CLASS}/votes`;
    await assertSucceeds(setDoc(doc(db('student'), `${V}/student`), { marks: { p1: 1 } }, { merge: true }));
    await assertSucceeds(setDoc(doc(db('student'), `${V}/student`), { marks: { p1: deleteField(), c1: -1 } }, { merge: true }));
    await assertFails(setDoc(doc(db('student'), `${V}/mayor`), { marks: { p1: 1 } }));
    await assertFails(setDoc(doc(db('student'), `${V}/student`), { marks: { p1: 1 }, extra: 1 }));
    await assertFails(setDoc(doc(db('student'), `${V}/student`), { marks: 'up' }));
    await assertFails(setDoc(doc(db('outsider'), `${V}/outsider`), { marks: { p1: 1 } }));
    await assertSucceeds(getDocs(collection(db('mayor'), V)));
    await assertFails(getDocs(collection(db('outsider'), V)));
    await assertFails(deleteDoc(doc(db('mayor'), `${V}/student`)));
    await assertSucceeds(deleteDoc(doc(db('student'), `${V}/student`)));
  });

  await test('A device token belongs to its owner only', async () => {
    const device = (who, fields = {}) => ({ uid: who, token: 'tok-' + who, platform: 'WEB', muted: [], updatedAtMillis: Date.now(), ...fields });
    await assertSucceeds(setDoc(doc(db('student'), 'devices/student_a'), device('student')));
    await assertSucceeds(setDoc(doc(db('student'), 'devices/student_a'), device('student', { muted: ['NO_CLASS'] })));
    await assertSucceeds(getDoc(doc(db('student'), 'devices/student_a')));
    await assertFails(getDoc(doc(db('mayor'), 'devices/student_a')));
    await assertFails(setDoc(doc(db('mayor'), 'devices/student_a'), device('mayor')));
    await assertFails(setDoc(doc(db('mayor'), 'devices/mayor_a'), device('student')));
    await assertFails(setDoc(doc(db('mayor'), 'devices/mayor_a'), device('mayor', { platform: 'IOS' })));
    await assertFails(setDoc(doc(db('mayor'), 'devices/mayor_a'), device('mayor', { token: '' })));
    await assertFails(deleteDoc(doc(db('mayor'), 'devices/student_a')));
    await assertSucceeds(deleteDoc(doc(db('student'), 'devices/student_a')));
  });

  await test('A member sets their own last-name-first form, and nobody else\'s', async () => {
    await assertSucceeds(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { sortName: 'Two, Student' }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { sortName: '' }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { sortName: 'x'.repeat(101) }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { sortName: 'Two, Student', roleId: 'mayor' }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/mayor`), { sortName: 'Hacked, Name' }));
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { sortName: 'Other, Name' }));
  });

  // ---------------------------------------------------------------- Join requests: other officers

  await test('A Treasurer (no MEMBERS_MANAGE) cannot list, approve or reject requests', async () => {
    const t = db('maria');
    await assertFails(getDocs(collection(t, `classes/${CLASS}/joinRequests`)));
    await assertFails(approveBatch(t, 'maria', 'pending').commit());
    await assertFails(deleteDoc(doc(t, `classes/${CLASS}/joinRequests/rejected`)));
  });

  await test('Another officer with MEMBERS_MANAGE rejects a request', async () => {
    await assertSucceeds(getDocs(collection(db('clerk'), `classes/${CLASS}/joinRequests`)));
    await assertSucceeds(deleteDoc(doc(db('clerk'), `classes/${CLASS}/joinRequests/rejected`)));
    await assertFails(getDoc(doc(db('rejected'), `classes/${CLASS}`)));
  });

  await test('A student cancels their own request (and may ask again); another student cannot cancel it', async () => {
    await assertFails(deleteDoc(doc(db('pending'), `classes/${CLASS}/joinRequests/quitter`)));
    await assertSucceeds(deleteDoc(doc(db('quitter'), `classes/${CLASS}/joinRequests/quitter`)));
    await assertSucceeds(requestJoin(db('quitter'), 'quitter'));
  });

  await test('Another officer with MEMBERS_MANAGE approves a request', () =>
    assertSucceeds(approveBatch(db('clerk'), 'clerk', 'quitter').commit()));

  // ---------------------------------------------------------------- Courses, settings, invite code

  await test('The Mayor adds a course; a Member cannot', async () => {
    await assertSucceeds(setDoc(doc(db('mayor'), `classes/${CLASS}/courses/or`), { id: '', name: 'Operations Research' }));
    await assertFails(setDoc(doc(db('student'), `classes/${CLASS}/courses/x`), { id: '', name: 'Fake course' }));
  });

  await test('The Mayor changes class settings and the invite name together', async () => {
    const store = db('mayor');
    const b = writeBatch(store);
    b.update(doc(store, `classes/${CLASS}`), { name: 'BSM CS 3A (1st Sem)', accentColor: '#2563EB' });
    b.update(doc(store, `invites/${CODE}`), { className: 'BSM CS 3A (1st Sem)' });
    await assertSucceeds(b.commit());
  });

  await test('The announcements and timetable switches are class settings', async () => {
    await assertSucceeds(updateDoc(doc(db('clerk'), `classes/${CLASS}`), { announcementsEnabled: false, timetableEnabled: false }));
    await assertFails(updateDoc(doc(db('sec'), `classes/${CLASS}`), { announcementsEnabled: true }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}`), { timetableEnabled: true }));
  });

  await test('The Mayor picks schedule icons; a Member cannot', async () => {
    await assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { scheduleIcons: { QUIZ: 'calculator', FCO: 'trophy' } }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}`), { scheduleIcons: { QUIZ: 'star' } }));
  });

  await test('The Mayor picks icon colors and content icons; a Member cannot', async () => {
    await assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}`), {
      scheduleColors: { QUIZ: '#15803D' }, contentIcons: { VIDEO: 'video' }, contentColors: { FILE: '#475569' },
    }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}`), { contentColors: { FILE: '#000000' } }));
  });

  await test('Schedule icons must be a short map', async () => {
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { scheduleIcons: 'calculator' }));
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { scheduleIcons: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' } }));
  });

  await test('Nobody can change the class owner', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { ownerUid: 'student' })));

  await test('A Member cannot change class settings', () =>
    assertFails(updateDoc(doc(db('student'), `classes/${CLASS}`), { name: 'Hacked' })));

  await test('A Member cannot make a new invite code', async () => {
    const store = db('student');
    const b = writeBatch(store);
    b.delete(doc(store, `invites/${CODE}`));
    b.set(doc(store, 'invites/HACK22'), { classId: CLASS, className: 'x' });
    b.update(doc(store, `classes/${CLASS}`), { inviteCode: 'HACK22' });
    await assertFails(b.commit());
  });

  await test('The Treasurer sets balance visibility and payment info', () =>
    assertSucceeds(updateDoc(doc(db('maria'), `classes/${CLASS}`), { balanceVisibility: 'OFFICERS', paymentInfo: 'GCash 0917 000 0000 (Maria)' })));

  await test('Balance visibility must be EVERYONE, OFFICERS or TREASURERS, and payment info is capped', async () => {
    const ref = doc(db('maria'), `classes/${CLASS}`);
    await assertFails(updateDoc(ref, { balanceVisibility: 'NOBODY' }));
    await assertFails(updateDoc(ref, { balanceVisibility: 'officers' }));
    await assertFails(updateDoc(ref, { paymentInfo: 'x'.repeat(501) }));
    await assertFails(updateDoc(ref, { paymentInfo: 917 }));
    await assertSucceeds(updateDoc(ref, { balanceVisibility: 'TREASURERS', paymentInfo: 'x'.repeat(500) }));
  });

  await test('CLASS_SETTINGS alone cannot change balance visibility or payment info', async () => {
    const ref = doc(db('clerk'), `classes/${CLASS}`);
    await assertFails(updateDoc(ref, { balanceVisibility: 'EVERYONE' }));
    await assertFails(updateDoc(ref, { paymentInfo: 'Send it to me' }));
    await assertFails(updateDoc(ref, { description: 'Clerk was here', paymentInfo: 'Send it to me' }));
    await assertSucceeds(updateDoc(ref, { description: 'Clerk was here' }));
  });

  await test('A Treasurer cannot change class settings, even together with payment info', async () => {
    const ref = doc(db('maria'), `classes/${CLASS}`);
    await assertFails(updateDoc(ref, { name: 'Maria\'s class' }));
    await assertFails(updateDoc(ref, { paymentInfo: 'GCash 0917', description: 'Mine' }));
    await assertFails(updateDoc(ref, { inviteCode: 'HACK22' }));
    await assertSucceeds(updateDoc(ref, { paymentInfo: 'GCash 0917 000 0000 (Maria)' }));
  });

  await test('The Secretary and plain members cannot change balance visibility', async () => {
    await assertFails(updateDoc(doc(db('sec'), `classes/${CLASS}`), { balanceVisibility: 'EVERYONE' }));
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}`), { balanceVisibility: 'EVERYONE' }));
  });

  await test('The Mayor (both permissions) changes settings and ledger settings in one write', () =>
    assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { description: 'Section A', balanceVisibility: 'EVERYONE' })));

  await test('Officers other than the owner cannot start deleting the class', async () => {
    await assertFails(updateDoc(doc(db('clerk'), `classes/${CLASS}`), { deletingAtMillis: now() }));
    await assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}`), { deletingAtMillis: now() }));
    await assertFails(updateDoc(doc(db('clerk'), `classes/${CLASS}`), { description: 'x', deletingAtMillis: now() }));
  });

  // ---------------------------------------------------------------- Ledger: records

  await test('A Member or Secretary cannot add ledger records', async () => {
    await assertFails(addRecordBatch(db('student'), payment('student', 'student')).b.commit());
    await assertFails(addRecordBatch(db('sec'), payment('sec', 'student')).b.commit());
  });

  await test('The Treasurer of one class cannot write the ledger of another class', () =>
    assertFails(addRecordBatch(db('maria'), payment('maria', 'owner2'), { classId: 'class2' }).b.commit()));

  let p1;
  await test('The Treasurer records a payment and updates the fund summary in one batch', async () => {
    p1 = addRecordBatch(db('maria'), payment('maria', 'student', 10000));
    await assertSucceeds(p1.b.commit());
  });

  await test('A record has exactly the v2 fields (the id is kept in the path, so it is empty or left out)', async () => {
    const good = payment('maria', 'student', 500);
    await assertFails(tryRecord('maria', omit(good, 'claimId')));
    await assertFails(tryRecord('maria', omit(good, 'voidReason')));
    await assertFails(tryRecord('maria', omit(good, 'createdAtMillis')));
    await assertFails(tryRecord('maria', { ...good, balanceAfter: 500 }));
    await assertFails(tryRecord('maria', { ...good, id: 'abc' }));
    await assertSucceeds(tryRecord('maria', omit(good, 'id')));
    await assertSucceeds(tryRecord('maria', good));
  });

  await test('A record is signed by its author at the time it is saved', async () => {
    await assertFails(tryRecord('maria', payment('mayor', 'student', 500)));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { createdAtMillis: now() + 30 * MINUTE })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { createdAtMillis: now() - 25 * HOUR })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { createdAtMillis: 0 })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { createdAtMillis: String(now()) })));
    // Written while offline and sent later, or by a phone whose clock runs a little ahead.
    await assertSucceeds(tryRecord('maria', payment('maria', 'student', 500, { createdAtMillis: now() - 23 * HOUR })));
    await assertSucceeds(tryRecord('maria', payment('maria', 'student', 500, { createdAtMillis: now() + 5 * MINUTE })));
  });

  await test('A record cannot be saved already voided', async () => {
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { voidedAtMillis: now() })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { voidedByUid: 'maria' })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { voidReason: 'x' })));
  });

  await test('Amounts are whole centavos from 1 to 100,000,000', async () => {
    for (const a of [0, -500, 100000001, 10.5]) await assertFails(tryRecord('maria', payment('maria', 'student', a)));
    for (const a of [1, 100000000]) await assertSucceeds(tryRecord('maria', payment('maria', 'student', a)));
  });

  await test('Only the five record types', async () => {
    await assertFails(tryRecord('maria', rec('REFUND', 500, 'maria', { memberId: 'student' })));
    await assertFails(tryRecord('maria', rec('payment', 500, 'maria', { memberId: 'student' })));
    await assertSucceeds(tryRecord('maria', rec('WITHDRAWAL', 500, 'maria', { memberId: 'student' })));
  });

  await test('Payments, withdrawals and opening balances name a member', async () => {
    await assertFails(tryRecord('maria', rec('PAYMENT', 500, 'maria')));
    await assertFails(tryRecord('maria', rec('WITHDRAWAL', 500, 'maria')));
    await assertFails(tryRecord('maria', rec('OPENING', 500, 'maria')));
    await assertFails(tryRecord('maria', rec('PAYMENT', 500, 'maria', { memberId: '  ' })));
  });

  await test('An opening balance is signed but never zero, at most 1,000,000 pesos either way', async () => {
    for (const a of [0, 100000001, -100000001, 1.5]) await assertFails(tryRecord('maria', rec('OPENING', a, 'maria', { memberId: 'student' })));
    for (const a of [-250000, 250000, -100000000]) await assertSucceeds(tryRecord('maria', rec('OPENING', a, 'maria', { memberId: 'student' })));
  });

  await test('Only a charge share has a batch id, only a pay-out settles one, and claims are not open yet', async () => {
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { batchId: 'q1' })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { settlesBatchId: 'q1' })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { claimId: 'c1' })));
  });

  await test('Text fields are strings within a length cap', async () => {
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { note: 'x'.repeat(201) })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { memberName: 'x'.repeat(91) })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { paidTo: 'x'.repeat(101) })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { note: 5 })));
    await assertFails(tryRecord('maria', payment('maria', 'student', 500, { dateMillis: '2026-11-10' })));
    await assertSucceeds(tryRecord('maria', payment('maria', 'student', 500, { note: 'x'.repeat(200) })));
  });

  await test('No balance limit: a withdrawal larger than the student\'s balance is recorded', () =>
    assertSucceeds(addRecordBatch(db('maria'), rec('WITHDRAWAL', 5000000, 'maria', { memberId: 'sec', memberName: 'Sec' })).b.commit()));

  await test('Records cannot be edited after saving', async () => {
    await assertFails(updateDoc(doc(db('maria'), p1.ref.path), { amountCentavos: 1 }));
    await assertFails(updateDoc(doc(db('mayor'), p1.ref.path), { note: 'changed' }));
    await assertFails(setDoc(doc(db('maria'), p1.ref.path), { ...p1.data, memberId: 'maria' }));
  });

  await test('Records cannot be deleted, not even by the Mayor', async () => {
    await assertFails(deleteDoc(doc(db('maria'), p1.ref.path)));
    await assertFails(deleteDoc(doc(db('mayor'), p1.ref.path)));
  });

  // ---------------------------------------------------------------- Ledger: voiding

  let w1;
  await test('Voiding needs a reason, the voider\'s own uid and the current time', async () => {
    w1 = addRecordBatch(db('maria'), rec('WITHDRAWAL', 2000, 'maria', { memberId: 'student', memberName: 'Student' }));
    await assertSucceeds(w1.b.commit());
    const t = db('maria');
    await assertFails(voidBatch(t, 'maria', w1, { reason: '' }).commit());
    await assertFails(voidBatch(t, 'maria', w1, { reason: '   ' }).commit());
    await assertFails(voidBatch(t, 'maria', w1, { reason: 'x'.repeat(201) }).commit());
    await assertFails(voidBatch(t, 'mayor', w1).commit());
    await assertFails(voidBatch(t, 'maria', w1, { fields: { voidedAtMillis: now() + HOUR } }).commit());
    await assertFails(voidBatch(t, 'maria', w1, { fields: { voidedAtMillis: 0 } }).commit());
  });

  await test('Voiding changes only the three void fields', async () => {
    await assertFails(voidBatch(db('maria'), 'maria', w1, { fields: { amountCentavos: 1 } }).commit());
    await assertFails(voidBatch(db('maria'), 'maria', w1, { fields: { createdByUid: 'mayor' } }).commit());
  });

  await test('A Member or Secretary cannot void a record', async () => {
    await assertFails(voidBatch(db('student'), 'student', w1).commit());
    await assertFails(voidBatch(db('sec'), 'sec', w1).commit());
  });

  await test('The Treasurer voids a withdrawal with a reason, and the summary drops it', () =>
    assertSucceeds(voidBatch(db('maria'), 'maria', w1, { reason: 'Entered twice' }).commit()));

  await test('A voided record can never be changed again or un-voided', async () => {
    const t = db('maria');
    await assertFails(updateDoc(doc(t, w1.ref.path), voidFields('maria', 'Another reason')));
    await assertFails(updateDoc(doc(t, w1.ref.path), { voidReason: 'Better reason' }));
    await assertFails(updateDoc(doc(t, w1.ref.path), { voidedAtMillis: 0, voidedByUid: '', voidReason: '' }));
    await assertFails(updateDoc(doc(db('mayor'), w1.ref.path), { voidedAtMillis: 0, voidedByUid: '', voidReason: '' }));
  });

  await test('The Mayor (the locked role) records and voids too', async () => {
    const r = addRecordBatch(db('mayor'), payment('mayor', 'clerk', 700));
    await assertSucceeds(r.b.commit());
    await assertSucceeds(voidBatch(db('mayor'), 'mayor', r).commit());
  });

  // ---------------------------------------------------------------- Ledger: charges

  const FOUR = ['student', 'maria', 'sec', 'clerk'];

  let q1;
  await test('The Treasurer charges four students: charge document, shares and summary in one batch', async () => {
    q1 = chargeBatch(db('maria'), 'maria', { batchId: 'q1', students: FOUR, per: 600 });
    await assertSucceeds(q1.b.commit());
  });

  await test('Charge shares cannot be saved without their charge document', () =>
    assertFails(chargeBatch(db('maria'), 'maria', { batchId: 'q2', students: FOUR, withCharge: false }).b.commit()));

  await test('A charge document adds up: total = amount per student x count', async () => {
    await assertFails(chargeBatch(db('maria'), 'maria', { batchId: 'q2', students: FOUR, chargeFields: { totalCentavos: 2000 } }).b.commit());
    await assertFails(chargeBatch(db('maria'), 'maria', { batchId: 'q2', students: FOUR, chargeFields: { count: 3 } }).b.commit());
  });

  await test('Every share of a one-amount charge is that amount', () =>
    assertFails(chargeBatch(db('maria'), 'maria', { batchId: 'q2', students: FOUR, shareFields: { amountCentavos: 500 } }).b.commit()));

  await test('A charge document is checked: author, time, not voided, a note, known fields, a payable total', async () => {
    const t = db('maria');
    for (const chargeFields of [
      { createdByUid: 'mayor' },
      { createdAtMillis: now() - 2 * 24 * HOUR },
      { voidedAtMillis: now(), voidedByUid: 'maria', voidReason: 'x' },
      { note: ' ' },
      { extra: 1 },
      { id: 'q2' },
      { count: 0, totalCentavos: 0 },
      { perMemberCentavos: 600.5 },
    ]) {
      await assertFails(chargeBatch(t, 'maria', { batchId: 'q2', students: FOUR, chargeFields }).b.commit());
    }
    // A total over 1,000,000 pesos could never be paid out by one pay-out.
    await assertFails(chargeBatch(t, 'maria', { batchId: 'q2', students: FOUR, per: 30000000 }).b.commit());
  });

  await test('A share must name the charge created with it', async () => {
    const t = db('maria');
    const b = writeBatch(t);
    b.set(doc(t, `classes/${CLASS}/charges/q2`), chargeData('maria', 1, 600));
    b.set(doc(collection(t, `classes/${CLASS}/records`)), rec('CHARGE', 600, 'maria', { memberId: 'student', batchId: 'q3' }));
    await assertFails(b.commit());
  });

  await test('A Secretary or plain member cannot charge', async () => {
    await assertFails(chargeBatch(db('sec'), 'sec', { batchId: 'q2', students: FOUR }).b.commit());
    await assertFails(chargeBatch(db('student'), 'student', { batchId: 'q2', students: FOUR }).b.commit());
  });

  let q2;
  await test('The Treasurer charges again (the valid form of the refused charges above)', async () => {
    q2 = chargeBatch(db('maria'), 'maria', { batchId: 'q2', students: FOUR, per: 600 });
    await assertSucceeds(q2.b.commit());
  });

  await test('A charge with different amounts per student stores 0 as the amount per student', async () => {
    await assertFails(chargeBatch(db('maria'), 'maria', { batchId: 'q3', students: ['student', 'sec'], amounts: [500, 700], chargeFields: { perMemberCentavos: 500, totalCentavos: 1000 } }).b.commit());
    await assertSucceeds(chargeBatch(db('maria'), 'maria', { batchId: 'q3', students: ['student', 'sec'], amounts: [500, 700] }).b.commit());
  });

  await test('Nobody adds a share to an old charge later', async () => {
    await assertFails(tryRecord('maria', rec('CHARGE', 600, 'maria', { memberId: 'quitter', batchId: 'q1' })));
    // Re-sending the charge document with it is an update, which is refused too.
    await assertFails(chargeBatch(db('maria'), 'maria', { batchId: 'q1', students: ['quitter'] }).b.commit());
  });

  await test('A charge document never changes its note, totals or count', async () => {
    const ref = `classes/${CLASS}/charges/q1`;
    await assertFails(updateDoc(doc(db('maria'), ref), { note: 'Quiz 2 - OR' }));
    await assertFails(updateDoc(doc(db('maria'), ref), { totalCentavos: 3000, count: 5 }));
    await assertFails(updateDoc(doc(db('mayor'), ref), { perMemberCentavos: 700 }));
  });

  await test('Charge documents cannot be deleted, not even by the Mayor', async () => {
    await assertFails(deleteDoc(doc(db('maria'), `classes/${CLASS}/charges/q1`)));
    await assertFails(deleteDoc(doc(db('mayor'), `classes/${CLASS}/charges/q1`)));
  });

  await test('Every member reads the charge documents; outsiders and waiting students cannot', async () => {
    await assertSucceeds(getDocs(collection(db('student'), `classes/${CLASS}/charges`)));
    await assertSucceeds(getDoc(doc(db('sec'), `classes/${CLASS}/charges/q1`)));
    await assertFails(getDocs(collection(db('outsider'), `classes/${CLASS}/charges`)));
    await assertFails(getDoc(doc(db('pending'), `classes/${CLASS}/charges/q1`)));
  });

  // ---------------------------------------------------------------- Ledger: pay-outs

  await test('A pay-out is for exactly the charge\'s total', async () => {
    await assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2000 }).b.commit());
    await assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2500 }).b.commit());
  });

  await test('A pay-out becomes its charge\'s pay-out in the same batch', () =>
    assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2400, linkCharge: false }).b.commit()));

  await test('A pay-out settles an existing charge and names no member', async () => {
    await assertFails(tryRecord('maria', rec('EXPENSE', 500, 'maria')));
    await assertFails(tryRecord('maria', rec('EXPENSE', 500, 'maria', { settlesBatchId: 'nope' })));
    await assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2400, recordFields: { memberId: 'student' } }).b.commit());
  });

  await test('A charge\'s payoutRecordId must name a new pay-out for that charge', async () => {
    const t = db('maria');
    const q1Ref = doc(t, `classes/${CLASS}/charges/q1`);
    // An existing record.
    await assertFails(updateDoc(q1Ref, { payoutRecordId: p1.ref.id }));
    // A new record that is not a pay-out.
    {
      const b = writeBatch(t);
      const ref = doc(collection(t, `classes/${CLASS}/records`));
      b.set(ref, payment('maria', 'student', 2400));
      b.update(q1Ref, { payoutRecordId: ref.id });
      await assertFails(b.commit());
    }
    // A valid pay-out of another charge (q2, same total).
    {
      const b = writeBatch(t);
      const ref = doc(collection(t, `classes/${CLASS}/records`));
      b.set(ref, rec('EXPENSE', 2400, 'maria', { settlesBatchId: 'q2', paidTo: 'Prof. Cruz' }));
      b.update(doc(t, `classes/${CLASS}/charges/q2`), { payoutRecordId: ref.id });
      b.update(q1Ref, { payoutRecordId: ref.id });
      await assertFails(b.commit());
    }
    // A record id that is not created at all.
    await assertFails(updateDoc(q1Ref, { payoutRecordId: 'missing' }));
  });

  await test('A Secretary or plain member cannot pay out', async () => {
    await assertFails(payoutBatch(db('sec'), 'sec', { batchId: 'q1', amount: 2400 }).b.commit());
    await assertFails(payoutBatch(db('student'), 'student', { batchId: 'q1', amount: 2400 }).b.commit());
  });

  let q1Payout;
  await test('The Treasurer pays the charge out: pay-out, payoutRecordId and summary in one batch', async () => {
    q1Payout = payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2400 });
    await assertSucceeds(q1Payout.b.commit());
    const charge = await assertSucceeds(getDoc(doc(db('student'), `classes/${CLASS}/charges/q1`)));
    expect(charge.get('payoutRecordId') === q1Payout.ref.id, 'payoutRecordId should name the pay-out');
  });

  await test('A charge has one standing pay-out: a second one is refused', async () => {
    await assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2400 }).b.commit());
    await assertFails(payoutBatch(db('mayor'), 'mayor', { batchId: 'q1', amount: 2400 }).b.commit());
    await assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2400, linkCharge: false }).b.commit());
  });

  await test('A charge cannot be voided while its pay-out stands', async () => {
    await assertFails(voidChargeBatch(db('maria'), 'maria', 'q1', q1.shares).commit());
    await assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}/charges/q1`), voidFields('maria')));
  });

  await test('Clearing payoutRecordId without voiding that pay-out is refused', async () => {
    const t = db('maria');
    await assertFails(updateDoc(doc(t, `classes/${CLASS}/charges/q1`), { payoutRecordId: '' }));
    // Voiding some other record in the same batch does not count.
    const b = writeBatch(t);
    b.update(doc(t, `classes/${CLASS}/charges/q1`), { payoutRecordId: '' });
    b.update(doc(t, p1.ref.path), voidFields('maria'));
    await assertFails(b.commit());
  });

  await test('Voiding a pay-out without clearing its charge\'s payoutRecordId is refused', () =>
    assertFails(voidPayoutBatch(db('maria'), 'maria', q1Payout, 'q1', { clear: false }).commit()));

  await test('The Treasurer voids the pay-out and clears payoutRecordId in one batch', () =>
    assertSucceeds(voidPayoutBatch(db('maria'), 'maria', q1Payout, 'q1').commit()));

  await test('A voided pay-out cannot be named as the pay-out again', () =>
    assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}/charges/q1`), { payoutRecordId: q1Payout.ref.id })));

  await test('After its pay-out is voided, the charge can be paid out again', () =>
    assertSucceeds(payoutBatch(db('maria'), 'maria', { batchId: 'q1', amount: 2400 }).b.commit()));

  // ---------------------------------------------------------------- Ledger: voiding a charge

  await test('A charge share cannot be voided on its own', async () => {
    await assertFails(voidBatch(db('maria'), 'maria', q2.shares[0]).commit());
    await assertFails(voidChargeBatch(db('maria'), 'maria', 'q2', q2.shares, { voidDoc: false }).commit());
  });

  await test('Voiding a charge needs RECORDS_MANAGE, a reason and the voider\'s own uid, and changes nothing else', async () => {
    await assertFails(voidChargeBatch(db('sec'), 'sec', 'q2', q2.shares).commit());
    await assertFails(voidChargeBatch(db('maria'), 'maria', 'q2', q2.shares, { chargeFields: { voidReason: '' } }).commit());
    await assertFails(voidChargeBatch(db('maria'), 'maria', 'q2', q2.shares, { chargeFields: { voidedByUid: 'mayor' } }).commit());
    await assertFails(voidChargeBatch(db('maria'), 'maria', 'q2', q2.shares, { chargeFields: { note: 'changed' } }).commit());
  });

  await test('The Treasurer voids a whole charge: document and every share in one batch', () =>
    assertSucceeds(voidChargeBatch(db('maria'), 'maria', 'q2', q2.shares).commit()));

  await test('A voided charge cannot be paid out, un-voided or voided again', async () => {
    await assertFails(payoutBatch(db('maria'), 'maria', { batchId: 'q2', amount: 2400 }).b.commit());
    await assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}/charges/q2`), { voidedAtMillis: 0, voidedByUid: '', voidReason: '' }));
    await assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}/charges/q2`), voidFields('maria', 'Again')));
    await assertFails(updateDoc(doc(db('maria'), q2.shares[0].ref.path), voidFields('maria', 'Again')));
  });

  await test('Charge and pay out in one batch (the new charge document names the new pay-out)', () =>
    assertSucceeds(chargeBatch(db('maria'), 'maria', { batchId: 'q4', students: FOUR, payout: true }).b.commit()));

  await test('A new charge can only name a pay-out that is created with it, for its total', async () => {
    const t = db('maria');
    await assertFails(chargeBatch(t, 'maria', { batchId: 'q5', students: FOUR, chargeFields: { payoutRecordId: 'missing' } }).b.commit());
    await assertFails(chargeBatch(t, 'maria', { batchId: 'q5', students: FOUR, chargeFields: { payoutRecordId: p1.ref.id } }).b.commit());
    await assertFails(chargeBatch(t, 'maria', { batchId: 'q5', students: FOUR, payout: true, payoutFields: { amountCentavos: 100 } }).b.commit());
    await assertFails(chargeBatch(t, 'maria', { batchId: 'q5', students: FOUR, payout: true, payoutFields: { voidedAtMillis: now(), voidedByUid: 'maria', voidReason: 'x' } }).b.commit());
    await assertSucceeds(chargeBatch(t, 'maria', { batchId: 'q5', students: FOUR, payout: true }).b.commit());
  });

  // ---------------------------------------------------------------- Ledger: opening balances

  /** Applying a pending opening balance: the OPENING record opening-{uid}, the entry deleted and the summary, in one batch. */
  function applyOpeningBatch(store, by, student, amount) {
    const data = rec('OPENING', amount, by, { memberId: student, memberName: nameOf(student), note: 'Opening balance' });
    const r = addRecordBatch(store, data, { id: `opening-${student}` });
    r.b.delete(doc(store, `classes/${CLASS}/openingBalances/${student}`));
    return r.b;
  }

  await test('Only records managers read pending opening balances', async () => {
    await admin((a) => setDoc(doc(a, `classes/${CLASS}/openingBalances/quitter`), { amountCentavos: -15000, note: 'From the 1st sem sheet' }));
    await assertSucceeds(getDocs(collection(db('maria'), `classes/${CLASS}/openingBalances`)));
    await assertSucceeds(getDoc(doc(db('mayor'), `classes/${CLASS}/openingBalances/quitter`)));
    await assertFails(getDoc(doc(db('quitter'), `classes/${CLASS}/openingBalances/quitter`)));
    await assertFails(getDocs(collection(db('sec'), `classes/${CLASS}/openingBalances`)));
    await assertFails(getDocs(collection(db('clerk'), `classes/${CLASS}/openingBalances`)));
  });

  await test('Applying an opening balance needs RECORDS_MANAGE', () =>
    assertFails(applyOpeningBatch(db('sec'), 'sec', 'quitter', -15000).commit()));

  await test('The Treasurer applies a pending opening balance: record opening-{uid} and the entry deleted in one batch', async () => {
    await assertSucceeds(applyOpeningBatch(db('maria'), 'maria', 'quitter', -15000).commit());
    const entry = await assertSucceeds(getDoc(doc(db('maria'), `classes/${CLASS}/openingBalances/quitter`)));
    expect(!entry.exists(), 'the entry should be gone');
  });

  await test('An opening balance cannot be applied twice (the record id already exists)', async () => {
    await assertFails(applyOpeningBatch(db('maria'), 'maria', 'quitter', -15000).commit());
    await admin((a) => setDoc(doc(a, `classes/${CLASS}/openingBalances/quitter`), { amountCentavos: -15000, note: 'From the 1st sem sheet' }));
    await assertFails(applyOpeningBatch(db('mayor'), 'mayor', 'quitter', -15000).commit());
    await assertSucceeds(deleteDoc(doc(db('maria'), `classes/${CLASS}/openingBalances/quitter`)));
  });

  await test('A records manager writes an opening balance entry; others cannot; it must be valid', async () => {
    const ref = (u) => doc(db(u), `classes/${CLASS}/openingBalances/latecomer`);
    await assertFails(setDoc(ref('sec'), { amountCentavos: 5000, note: '' }));
    await assertFails(setDoc(ref('student'), { amountCentavos: 5000, note: '' }));
    await assertFails(setDoc(ref('maria'), { amountCentavos: 0, note: '' }));
    await assertFails(setDoc(ref('maria'), { amountCentavos: 50.5, note: '' }));
    await assertFails(setDoc(ref('maria'), { amountCentavos: 5000, note: '', memberName: 'Late' }));
    await assertFails(setDoc(ref('maria'), { amountCentavos: 5000 }));
    await assertSucceeds(setDoc(ref('maria'), { amountCentavos: -5000, note: '' }));
    await assertFails(deleteDoc(ref('student')));
    await assertSucceeds(deleteDoc(ref('maria')));
  });

  // ---------------------------------------------------------------- Ledger: the fund summary

  await test('Every member reads the fund summary; waiting students and outsiders cannot', async () => {
    const s = await assertSucceeds(getDoc(doc(db('student'), `classes/${CLASS}/summary/fund`)));
    expect(s.exists() && Number.isInteger(s.get('cashOnHandCentavos')) && s.get('recordCount') > 0, 'the summary should hold whole numbers');
    await assertSucceeds(getDocs(collection(db('sec'), `classes/${CLASS}/summary`)));
    await assertFails(getDoc(doc(db('pending'), `classes/${CLASS}/summary/fund`)));
    await assertFails(getDoc(doc(db('outsider'), `classes/${CLASS}/summary/fund`)));
  });

  await test('Only records managers write the summary', async () => {
    await assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/summary/fund`), { cashOnHandCentavos: increment(100000) }));
    await assertFails(updateDoc(doc(db('sec'), `classes/${CLASS}/summary/fund`), { cashOnHandCentavos: 0 }));
    await assertFails(deleteDoc(doc(db('mayor'), `classes/${CLASS}/summary/fund`)));
  });

  await test('The summary holds exactly its five whole-number fields, only at summary/fund', async () => {
    const t = db('maria');
    const ref = doc(t, `classes/${CLASS}/summary/fund`);
    const whole = { cashOnHandCentavos: 1, waitingPayoutCentavos: 2, balancesTotalCentavos: 3, recordCount: 4, updatedAtMillis: now() };
    await assertFails(updateDoc(ref, { cashOnHandCentavos: increment(0.5) }));
    await assertFails(updateDoc(ref, { note: 'x' }));
    await assertFails(setDoc(ref, omit(whole, 'updatedAtMillis')));
    await assertFails(setDoc(ref, { ...whole, recordCount: '4' }));
    await assertFails(setDoc(doc(t, `classes/${CLASS}/summary/other`), whole));
    await assertSucceeds(updateDoc(ref, { recordCount: increment(0), updatedAtMillis: now() }));
  });

  await test('The Treasurer repairs the summary by rewriting it whole', () =>
    assertSucceeds(setDoc(doc(db('maria'), `classes/${CLASS}/summary/fund`), {
      cashOnHandCentavos: 0, waitingPayoutCentavos: 0, balancesTotalCentavos: 0, recordCount: 0, updatedAtMillis: now(),
    })));

  // ---------------------------------------------------------------- Balance visibility

  const VIS = 'vis';
  const VIS_CODE = 'VWXYZ2';
  let vExpenseId;
  await test('Visibility class: Mayor, Treasurer, Secretary, custom role, member, a waiting student (all through the rules)', async () => {
    await assertSucceeds(createClassBatch(db('vmayor'), 'vmayor', { classId: VIS, code: VIS_CODE }).commit());
    for (const u of ['vtreas', 'vsec', 'vpio', 'vmem']) await joinVia('vmayor', u, { classId: VIS, code: VIS_CODE });
    await assertSucceeds(requestJoin(db('vpending'), 'vpending', { classId: VIS, code: VIS_CODE }));
    const m = db('vmayor');
    await assertSucceeds(setDoc(doc(m, `classes/${VIS}/roles/pio`), { id: '', name: 'PIO', colorHex: '#BE123C', permissions: ['SCHEDULE_MANAGE'], locked: false }));
    await assertSucceeds(updateDoc(doc(m, `classes/${VIS}/members/vtreas`), { roleId: 'treasurer' }));
    await assertSucceeds(updateDoc(doc(m, `classes/${VIS}/members/vsec`), { roleId: 'secretary' }));
    await assertSucceeds(updateDoc(doc(m, `classes/${VIS}/members/vpio`), { roleId: 'pio' }));
    const t = db('vtreas');
    await assertSucceeds(addRecordBatch(t, payment('vtreas', 'ghost', 5000), { classId: VIS, id: 'ghostPay' }).b.commit());
    await assertSucceeds(addRecordBatch(t, payment('vtreas', 'vmem', 3000), { classId: VIS, id: 'memPay' }).b.commit());
    const c = chargeBatch(t, 'vtreas', { classId: VIS, batchId: 'v1', students: ['vmem', 'vsec'], payout: true });
    await assertSucceeds(c.b.commit());
    vExpenseId = c.payout.ref.id;
  });

  await test('Only RECORDS_MANAGE changes balance visibility (not the Secretary, a custom officer or a member)', async () => {
    for (const u of ['vsec', 'vpio', 'vmem', 'vpending', 'voutsider']) {
      await assertFails(updateDoc(doc(db(u), `classes/${VIS}`), { balanceVisibility: 'TREASURERS' }));
    }
    await assertSucceeds(updateDoc(doc(db('vmayor'), `classes/${VIS}`), { balanceVisibility: 'EVERYONE' }));
  });

  const VIEWERS = {
    vmayor: 'the Mayor',
    vtreas: 'the Treasurer',
    vsec: 'the Secretary',
    vpio: 'a custom role with one unrelated permission',
    vmem: 'a plain member',
    vpending: 'a waiting student',
    voutsider: 'an outsider',
  };
  const inVisClass = (v) => !['vpending', 'voutsider'].includes(v);
  function seesEveryRecord(viewer, setting) {
    if (!inVisClass(viewer)) return false;
    if (viewer === 'vmayor' || viewer === 'vtreas') return true;
    if (setting === 'EVERYONE') return true;
    if (setting === 'OFFICERS') return viewer !== 'vmem';
    return false;
  }

  for (const setting of ['EVERYONE', 'OFFICERS', 'TREASURERS']) {
    await test(`Visibility ${setting}: the Treasurer sets it`, () =>
      assertSucceeds(updateDoc(doc(db('vtreas'), `classes/${VIS}`), { balanceVisibility: setting })));
    for (const [viewer, label] of Object.entries(VIEWERS)) {
      const all = seesEveryRecord(viewer, setting);
      const own = inVisClass(viewer);
      const what = all ? 'reads every record' : own ? 'reads only their own records and the pay-outs' : 'reads no records';
      await test(`Visibility ${setting}: ${label} ${what}`, async () => {
        const s = db(viewer);
        const records = collection(s, `classes/${VIS}/records`);
        const check = (allowed, read) => (allowed ? assertSucceeds(read()) : assertFails(read()));
        await check(all, () => getDoc(doc(s, `classes/${VIS}/records/ghostPay`)));
        await check(all, () => getDocs(records));
        await check(all, () => getDocs(query(records, where('batchId', '==', 'v1'))));
        await check(own, () => getDocs(query(records, where('memberId', '==', viewer))));
        await check(own, () => getDocs(query(records, where('type', '==', 'EXPENSE'))));
        await check(own, () => getDoc(doc(s, `classes/${VIS}/records/${vExpenseId}`)));
        await check(own, () => getDoc(doc(s, `classes/${VIS}/summary/fund`)));
        await check(own, () => getDocs(collection(s, `classes/${VIS}/charges`)));
      });
    }
  }

  await test('A member who cannot see every record still gets their own records and every pay-out', async () => {
    const s = db('vmem');
    const records = collection(s, `classes/${VIS}/records`);
    const mine = await assertSucceeds(getDocs(query(records, where('memberId', '==', 'vmem'))));
    expect(mine.size === 2 && mine.docs.every((d) => d.get('memberId') === 'vmem'), `expected 2 own records, got ${mine.size}`);
    const payouts = await assertSucceeds(getDocs(query(records, where('type', '==', 'EXPENSE'))));
    expect(payouts.size === 1, 'expected one pay-out');
    await assertSucceeds(getDoc(doc(s, `classes/${VIS}/records/memPay`)));
    await assertFails(getDocs(query(records, where('type', '==', 'CHARGE'))));
    await assertFails(getDocs(query(records, where('memberId', '==', 'vsec'))));
  });

  await test('A waiting student reads nothing in the class, whatever the setting', async () => {
    const s = db('vpending');
    await assertFails(getDoc(doc(s, `classes/${VIS}`)));
    await assertFails(getDocs(collection(s, `classes/${VIS}/members`)));
    await assertFails(getDocs(collection(s, `classes/${VIS}/charges`)));
    await assertFails(getDoc(doc(s, `classes/${VIS}/summary/fund`)));
    await assertFails(getDoc(doc(s, `classes/${VIS}/records/ghostPay`)));
    await assertSucceeds(getDoc(doc(s, `classes/${VIS}/joinRequests/vpending`)));
  });

  // ---------------------------------------------------------------- Rule read limits: 40 students

  const BIG = 'big';
  const forty = Array.from({ length: 40 }, (_, i) => `s${i}`);
  await test('A class of 40 students and a Treasurer (members seeded)', async () => {
    await assertSucceeds(createClassBatch(db('bigmayor'), 'bigmayor', { classId: BIG, code: 'BCDFGH' }).commit());
    await admin(async (a) => {
      const b = writeBatch(a);
      for (const s of forty) b.set(doc(a, `classes/${BIG}/members/${s}`), memberData(s, { approvedByUid: 'bigmayor' }));
      b.set(doc(a, `classes/${BIG}/members/bigtreas`), memberData('bigtreas', { roleId: 'treasurer', approvedByUid: 'bigmayor' }));
      await b.commit();
    });
  });

  let big1;
  await test('The Treasurer charges 40 students and pays out in one batch (40 shares, charge, pay-out, summary)', async () => {
    big1 = chargeBatch(db('bigtreas'), 'bigtreas', { classId: BIG, batchId: 'b1', students: forty, per: 600, payout: true });
    await assertSucceeds(big1.b.commit());
  });

  let big2;
  await test('The Treasurer charges 40 students without paying out', async () => {
    big2 = chargeBatch(db('bigtreas'), 'bigtreas', { classId: BIG, batchId: 'b2', students: forty, per: 1500 });
    await assertSucceeds(big2.b.commit());
  });

  await test('The Treasurer voids a 40-student charge in one batch (charge document, 40 shares, summary)', () =>
    assertSucceeds(voidChargeBatch(db('bigtreas'), 'bigtreas', 'b2', big2.shares, { classId: BIG }).commit()));

  await test('The Treasurer voids the 40-student pay-out, then the 40-student charge', async () => {
    await assertSucceeds(voidPayoutBatch(db('bigtreas'), 'bigtreas', big1.payout, 'b1', { classId: BIG }).commit());
    await assertSucceeds(voidChargeBatch(db('bigtreas'), 'bigtreas', 'b1', big1.shares, { classId: BIG }).commit());
  });

  await test('The Mayor charges 40 students and pays out in one batch too', () =>
    assertSucceeds(chargeBatch(db('bigmayor'), 'bigmayor', { classId: BIG, batchId: 'b3', students: forty, per: 2500, payout: true }).b.commit()));

  // ---------------------------------------------------------------- Schedule and done marks

  await test('A Member cannot add schedule items; the Mayor can', async () => {
    const item = { id: '', courseId: 'or', title: 'Midterm', kind: 'EXAM', dueMillis: 5, status: 'PENDING', note: '', createdByUid: 'mayor' };
    await assertFails(setDoc(doc(db('student'), `classes/${CLASS}/schedule/x`), item));
    await assertSucceeds(setDoc(doc(db('mayor'), `classes/${CLASS}/schedule/midterm`), item));
  });

  await test('The Secretary manages the schedule', () =>
    assertSucceeds(updateDoc(doc(db('sec'), `classes/${CLASS}/schedule/midterm`), { status: 'CANCELLED' })));

  await test('A student marks an item done for themselves (and undoes it)', async () => {
    const store = db('student');
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/student`), { done: { midterm: 123 } }, { merge: true }));
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/student`), { done: { midterm: deleteField() } }, { merge: true }));
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/student`), { done: { midterm: 456 } }, { merge: true }));
  });

  await test('A student cannot mark items for someone else', () =>
    assertFails(setDoc(doc(db('student'), `classes/${CLASS}/progress/maria`), { done: { midterm: 1 } }, { merge: true })));

  await test('A waiting student cannot mark items done', () =>
    assertFails(setDoc(doc(db('pending'), `classes/${CLASS}/progress/pending`), { done: { midterm: 1 } })));

  await test('A student can see a classmate\'s marks', () =>
    assertSucceeds(getDoc(doc(db('student'), `classes/${CLASS}/progress/maria`))));

  await test('An outsider cannot see anyone\'s marks', () =>
    assertFails(getDocs(collection(db('outsider'), `classes/${CLASS}/progress`))));

  await test('A student can read their own marks', () =>
    assertSucceeds(getDoc(doc(db('student'), `classes/${CLASS}/progress/student`))));

  await test('The Mayor (manages schedule) can see everyone\'s marks', () =>
    assertSucceeds(getDocs(collection(db('mayor'), `classes/${CLASS}/progress`))));

  await test('A student can list everyone\'s marks', () =>
    assertSucceeds(getDocs(collection(db('student'), `classes/${CLASS}/progress`))));

  await test('Extra fields in the marks document are blocked', () =>
    assertFails(setDoc(doc(db('maria'), `classes/${CLASS}/progress/maria`), { done: {}, grade: 100 })));

  // ---------------------------------------------------------------- Contents

  await test('A Member cannot add class contents; the Mayor can', async () => {
    const item = { id: '', courseId: 'or', title: 'Module 1', url: 'https://drive.google.com/x', kind: 'FILE', note: '', createdByUid: 'mayor', createdAtMillis: 1 };
    await assertFails(setDoc(doc(db('student'), `classes/${CLASS}/contents/x`), item));
    await assertSucceeds(setDoc(doc(db('mayor'), `classes/${CLASS}/contents/m1`), item));
    await assertSucceeds(getDocs(collection(db('student'), `classes/${CLASS}/contents`)));
  });

  await test('The Secretary manages contents; a waiting student cannot read them', async () => {
    await assertSucceeds(updateDoc(doc(db('sec'), `classes/${CLASS}/contents/m1`), { title: 'Module 1 (revised)' }));
    await assertFails(getDocs(collection(db('pending'), `classes/${CLASS}/contents`)));
  });

  await test('An uploaded file on a content item has the right shape', async () => {
    const file = { key: 'AbCdEfGhIjKlMnOpQrSt', name: 'Week 1.pdf', sizeBytes: 5000, mimeType: 'application/pdf' };
    const item = { id: '', courseId: '', title: 'Week 1', url: '', kind: 'FILE', note: '', createdByUid: 'mayor', createdAtMillis: 1 };
    const put = (fields) => setDoc(doc(db('mayor'), `classes/${CLASS}/contents/f1`), { ...item, ...fields });
    await assertSucceeds(put({ file }));
    await assertSucceeds(put({ file: null }));
    await assertSucceeds(updateDoc(doc(db('sec'), `classes/${CLASS}/contents/f1`), { file }));
    await assertFails(put({ file: { ...file, key: '../other-class/x' } }));
    await assertFails(put({ file: { ...file, sizeBytes: 10485761 } }));
    await assertFails(put({ file: { ...file, sizeBytes: 0 } }));
    await assertFails(put({ file: { ...file, name: '' } }));
    await assertFails(put({ file: { ...file, extra: 1 } }));
    await assertFails(put({ file: { key: file.key } }));
    await assertFails(put({ file: 'AbCdEfGhIjKlMnOpQrSt' }));
    await assertFails(setDoc(doc(db('student'), `classes/${CLASS}/contents/f2`), { ...item, file }));
    await assertSucceeds(deleteDoc(doc(db('mayor'), `classes/${CLASS}/contents/f1`)));
  });

  // ---------------------------------------------------------------- Invite code and removing members

  await test('An invite has exactly classId and className, and only for one\'s own class', async () => {
    const m = db('mayor');
    await assertFails(setDoc(doc(m, 'invites/ABCDEF'), { classId: CLASS, className: 'x', defaultRoleId: 'treasurer' }));
    await assertFails(setDoc(doc(m, 'invites/ABCDEF'), { classId: CLASS, className: '' }));
    await assertFails(setDoc(doc(m, 'invites/ABCDEF'), { classId: 'class2', className: 'BSM CS 3A' }));
    await assertFails(setDoc(doc(m, `invites/${OTHER_CODE}`), { classId: CLASS, className: 'BSM CS 3A' }));
  });

  await test('The Mayor makes a new invite code; the old code stops working for new requests', async () => {
    const store = db('mayor');
    const b = writeBatch(store);
    b.delete(doc(store, `invites/${CODE}`));
    b.set(doc(store, `invites/${NEW_CODE}`), { classId: CLASS, className: 'BSM CS 3A (1st Sem)' });
    b.update(doc(store, `classes/${CLASS}`), { inviteCode: NEW_CODE });
    await assertSucceeds(b.commit());
    await assertFails(requestJoin(db('late'), 'late', { code: CODE }));
    await assertSucceeds(requestJoin(db('late'), 'late', { code: NEW_CODE }));
    await assertSucceeds(approveBatch(db('mayor'), 'mayor', 'late').commit());
  });

  await test('A Member cannot remove anyone', () =>
    assertFails(deleteDoc(doc(db('student'), `classes/${CLASS}/members/late`))));

  await test('The class owner cannot be removed', async () => {
    await assertFails(deleteDoc(doc(db('mayor'), `classes/${CLASS}/members/mayor`)));
    await assertFails(deleteDoc(doc(db('clerk'), `classes/${CLASS}/members/mayor`)));
  });

  await test('The Mayor removes a student', () =>
    assertSucceeds(deleteDoc(doc(db('mayor'), `classes/${CLASS}/members/late`))));

  await test('A removed student loses access but can still see that they were removed', async () => {
    const store = db('late');
    await assertFails(getDoc(doc(store, `classes/${CLASS}`)));
    await assertFails(getDocs(query(collection(store, `classes/${CLASS}/records`), where('memberId', '==', 'late'))));
    const own = await assertSucceeds(getDoc(doc(store, `classes/${CLASS}/members/late`)));
    expect(!own.exists(), 'member entry should be gone');
    const mine = await assertSucceeds(myMemberEntries(store, 'late'));
    expect(mine.size === 0, 'the class should be off "My classes"');
  });

  // ---------------------------------------------------------------- Photos

  await test('A student sets and removes their own profile photo', async () => {
    const store = db('student');
    await assertSucceeds(setDoc(doc(store, 'avatars/student'), photo()));
    await assertSucceeds(deleteDoc(doc(store, 'avatars/student')));
    await assertSucceeds(setDoc(doc(store, 'avatars/student'), photo()));
  });

  await test('Nobody can change someone else\'s profile photo', async () => {
    await assertFails(setDoc(doc(db('maria'), 'avatars/student'), photo()));
    await assertFails(deleteDoc(doc(db('maria'), 'avatars/student')));
  });

  await test('Signed-in users can see profile photos; signed-out users cannot', async () => {
    await assertSucceeds(getDoc(doc(db('maria'), 'avatars/student')));
    await assertFails(getDoc(doc(anon(), 'avatars/student')));
  });

  await test('An oversized photo or extra fields are blocked', async () => {
    await assertFails(setDoc(doc(db('student'), 'avatars/student'), photo(400000)));
    await assertFails(setDoc(doc(db('student'), 'avatars/student'), { ...photo(), secret: 'x' }));
  });

  await test('The Mayor sets the class photo; members can see it', async () => {
    await assertSucceeds(setDoc(doc(db('mayor'), `classPhotos/${CLASS}`), photo()));
    await assertSucceeds(getDoc(doc(db('student'), `classPhotos/${CLASS}`)));
  });

  await test('A Member cannot change or remove the class photo', async () => {
    await assertFails(setDoc(doc(db('student'), `classPhotos/${CLASS}`), photo()));
    await assertFails(deleteDoc(doc(db('student'), `classPhotos/${CLASS}`)));
  });

  await test('An outsider or a waiting student cannot see the class photo', async () => {
    await assertFails(getDoc(doc(db('outsider'), `classPhotos/${CLASS}`)));
    await assertFails(getDoc(doc(db('pending'), `classPhotos/${CLASS}`)));
  });

  await test('The Mayor removes the class photo', () =>
    assertSucceeds(deleteDoc(doc(db('mayor'), `classPhotos/${CLASS}`))));

  // ---------------------------------------------------------------- Leaving the class

  /** Leaving: only the member entry (there is no "My classes" copy any more). */
  function leaveBatch(store, uid, classId = CLASS) {
    const b = writeBatch(store);
    b.delete(doc(store, `classes/${classId}/members/${uid}`));
    return b;
  }

  /** The Mayor hands the class over and leaves, in one batch. */
  function handOverBatch(store, uid, newMayor, classId = CLASS) {
    const b = leaveBatch(store, uid, classId);
    b.update(doc(store, `classes/${classId}`), { ownerUid: newMayor });
    b.update(doc(store, `classes/${classId}/members/${newMayor}`), { roleId: 'mayor' });
    return b;
  }

  await test('Two more students join (asking with the current code, approved by the Mayor)', async () => {
    await joinVia('mayor', 'pedro', { code: NEW_CODE });
    await joinVia('mayor', 'ana', { code: NEW_CODE });
  });

  await test('A student leaves the class on their own and loses access', async () => {
    await assertSucceeds(leaveBatch(db('pedro'), 'pedro').commit());
    await assertFails(getDoc(doc(db('pedro'), `classes/${CLASS}`)));
  });

  await test('A student cannot make a classmate leave', () =>
    assertFails(leaveBatch(db('ana'), 'maria').commit()));

  await test('The Mayor cannot leave without handing over', () =>
    assertFails(leaveBatch(db('mayor'), 'mayor').commit()));

  await test('The Mayor cannot hand over and stay in the class', async () => {
    const store = db('mayor');
    const b = writeBatch(store);
    b.update(doc(store, `classes/${CLASS}`), { ownerUid: 'maria' });
    b.update(doc(store, `classes/${CLASS}/members/maria`), { roleId: 'mayor' });
    await assertFails(b.commit());
  });

  await test('The Mayor cannot hand over to someone outside the class', () =>
    assertFails(handOverBatch(db('mayor'), 'mayor', 'outsider').commit()));

  await test('Someone who is not the Mayor cannot hand the class over', () =>
    assertFails(handOverBatch(db('maria'), 'maria', 'ana').commit()));

  await test('A handover must also change the class owner', async () => {
    const store = db('mayor');
    const b = leaveBatch(store, 'mayor');
    b.update(doc(store, `classes/${CLASS}/members/maria`), { roleId: 'mayor' });
    await assertFails(b.commit());
  });

  await test('The Mayor makes Maria the new Mayor and leaves in one batch', async () => {
    await assertSucceeds(handOverBatch(db('mayor'), 'mayor', 'maria').commit());
    await assertFails(getDoc(doc(db('mayor'), `classes/${CLASS}`)));
  });

  await test('The new Mayor has every permission, and the old one has none', async () => {
    await assertSucceeds(updateDoc(doc(db('maria'), `classes/${CLASS}`), { description: 'Run by Maria now' }));
    await assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { description: 'Still mine?' }));
  });

  // ---------------------------------------------------------------- Account: name and deletion

  await test('A student changes their name on their profile and in the class in one batch', async () => {
    const store = db('ana');
    const b = writeBatch(store);
    b.set(doc(store, 'users/ana'), { displayName: 'Ana B. Reyes', firstName: 'Ana', middleInitial: 'B', lastName: 'Reyes' }, { merge: true });
    b.update(doc(store, `classes/${CLASS}/members/ana`), { name: 'Ana B. Reyes' });
    await assertSucceeds(b.commit());
  });

  await test('A student cannot rename a classmate', () =>
    assertFails(updateDoc(doc(db('ana'), `classes/${CLASS}/members/maria`), { name: 'Someone Else' })));

  await test('A rename cannot sneak in a role change or an empty name', async () => {
    await assertFails(updateDoc(doc(db('ana'), `classes/${CLASS}/members/ana`), { name: 'Ana Reyes', roleId: 'treasurer' }));
    await assertFails(updateDoc(doc(db('ana'), `classes/${CLASS}/members/ana`), { name: '' }));
  });

  await test('A student cannot delete a classmate\'s done marks', () =>
    assertFails(deleteDoc(doc(db('ana'), `classes/${CLASS}/progress/maria`))));

  await test('A student deletes their account data in one batch (member entries, done marks, waiting requests, photo, profile)', async () => {
    const store = db('ana');
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/ana`), { done: { midterm: 1 } }));
    await assertSucceeds(requestJoin(store, 'ana', { classId: 'class2', code: OTHER_CODE }));
    await assertSucceeds(setDoc(doc(store, 'avatars/ana'), photo()));
    const b = writeBatch(store);
    b.delete(doc(store, `classes/${CLASS}/members/ana`));
    b.delete(doc(store, `classes/${CLASS}/progress/ana`));
    b.delete(doc(store, 'classes/class2/joinRequests/ana'));
    b.delete(doc(store, 'avatars/ana'));
    b.delete(doc(store, 'users/ana'));
    await assertSucceeds(b.commit());
    await assertFails(getDoc(doc(store, `classes/${CLASS}`)));
    expect((await assertSucceeds(myMemberEntries(store, 'ana'))).size === 0, 'no classes should be left');
    expect((await assertSucceeds(myJoinRequests(store, 'ana'))).size === 0, 'no requests should be left');
  });

  await test('The Mayor cannot delete their account data without handing over', () =>
    assertFails(leaveBatch(db('maria'), 'maria').commit()));

  // ---------------------------------------------------------------- Error log

  const errorData = (extra = {}) => ({ message: 'TypeError: x is undefined', stack: 'at Ledger (Ledger.tsx:10)', appVersion: '2.0.0', platform: 'WEB', atMillis: now(), ...extra });

  await test('Anyone signed in logs an app error', () =>
    assertSucceeds(setDoc(doc(collection(db('student'), 'clientErrors')), errorData())));

  await test('Signed-out users cannot log errors', () =>
    assertFails(setDoc(doc(collection(anon(), 'clientErrors')), errorData())));

  await test('An error log entry has exactly its five fields within their size caps', async () => {
    const add = (data) => setDoc(doc(collection(db('student'), 'clientErrors')), data);
    await assertFails(add({ ...errorData(), uid: 'student' }));
    await assertFails(add(omit(errorData(), 'stack')));
    await assertFails(add(errorData({ message: 'x'.repeat(1001) })));
    await assertFails(add(errorData({ stack: 'x'.repeat(8001) })));
    await assertFails(add(errorData({ appVersion: 'x'.repeat(41) })));
    await assertFails(add(errorData({ platform: 'x'.repeat(21) })));
    await assertFails(add(errorData({ atMillis: 'now' })));
    await assertSucceeds(add(errorData({ stack: '', message: 'x'.repeat(1000) })));
  });

  await test('Nobody reads, changes or deletes error log entries from the app', async () => {
    const ref = doc(db('student'), 'clientErrors/e1');
    await assertSucceeds(setDoc(ref, errorData()));
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db('maria'), 'clientErrors')));
    await assertFails(updateDoc(ref, { message: 'changed' }));
    await assertFails(setDoc(ref, errorData()));
    await assertFails(deleteDoc(ref));
  });

  // ---------------------------------------------------------------- Deleting a class

  const DEL = 'class9';
  const DEL_CODE = 'DEL234';
  const students = Array.from({ length: 30 }, (_, i) => `stu${i}`);
  const del = {};

  await test('Class 9 is set up through the rules: 30 students, a Treasurer, a ledger, schedule, contents, photo', async () => {
    const owner = db('owner9');
    await assertSucceeds(createClassBatch(owner, 'owner9', { classId: DEL, code: DEL_CODE }).commit());
    for (const s of students) {
      await joinVia('owner9', s, { classId: DEL, code: DEL_CODE });
      await assertSucceeds(setDoc(doc(db(s), `classes/${DEL}/progress/${s}`), { done: { quiz1: 1 } }));
    }
    await assertSucceeds(updateDoc(doc(owner, `classes/${DEL}/members/stu0`), { roleId: 'treasurer' }));
    const t = db('stu0');
    del.pay = addRecordBatch(t, payment('stu0', 'stu1', 2000), { classId: DEL });
    await assertSucceeds(del.pay.b.commit());
    del.wd = addRecordBatch(t, rec('WITHDRAWAL', 2000, 'stu0', { memberId: 'stu1' }), { classId: DEL });
    await assertSucceeds(del.wd.b.commit());
    del.charge = chargeBatch(t, 'stu0', { classId: DEL, batchId: 'c9', students: ['stu2'], per: 500, payout: true });
    await assertSucceeds(del.charge.b.commit());
    await admin((a) => setDoc(doc(a, `classes/${DEL}/openingBalances/stu5`), { amountCentavos: 100, note: '' }));
    await assertSucceeds(setDoc(doc(owner, `classes/${DEL}/schedule/s1`), { title: 'Quiz 1', kind: 'QUIZ', dueMillis: 5 }));
    await assertSucceeds(setDoc(doc(owner, `classes/${DEL}/contents/c1`), { title: 'Syllabus', url: 'https://example.com', kind: 'WEBSITE' }));
    await assertSucceeds(setDoc(doc(owner, `classes/${DEL}/courses/or`), { id: '', name: 'Operations Research' }));
    await assertSucceeds(setDoc(doc(owner, `classPhotos/${DEL}`), photo()));
    await assertSucceeds(requestJoin(db('late9'), 'late9', { classId: DEL, code: DEL_CODE }));
  });

  await test('Before the delete starts, nobody deletes records, charges, the summary or others\' done marks, not even the Mayor', async () => {
    const owner = db('owner9');
    await assertFails(deleteDoc(doc(owner, del.pay.ref.path)));
    await assertFails(deleteDoc(doc(owner, `classes/${DEL}/charges/c9`)));
    await assertFails(deleteDoc(doc(owner, `classes/${DEL}/summary/fund`)));
    await assertFails(deleteDoc(doc(owner, `classes/${DEL}/progress/stu1`)));
    await assertFails(deleteDoc(doc(owner, `classes/${DEL}/roles/mayor`)));
    await assertFails(deleteDoc(doc(db('stu0'), del.pay.ref.path)));
  });

  await test('Only the owner starts deleting the class', async () => {
    await assertFails(updateDoc(doc(db('stu0'), `classes/${DEL}`), { deletingAtMillis: now() }));
    await assertFails(updateDoc(doc(db('stu1'), `classes/${DEL}`), { deletingAtMillis: now() }));
  });

  await test('Starting the delete sets only deletingAtMillis, to the current time', async () => {
    const ref = doc(db('owner9'), `classes/${DEL}`);
    await assertFails(updateDoc(ref, { deletingAtMillis: now(), name: 'Closing' }));
    await assertFails(updateDoc(ref, { deletingAtMillis: -1 }));
    await assertFails(updateDoc(ref, { deletingAtMillis: 'now' }));
    await assertFails(updateDoc(ref, { deletingAtMillis: now() + 2 * HOUR }));
  });

  await test('The owner starts deleting the class', () =>
    assertSucceeds(updateDoc(doc(db('owner9'), `classes/${DEL}`), { deletingAtMillis: now() })));

  await test('Once started, the delete cannot be cancelled or changed by anyone', async () => {
    await assertFails(updateDoc(doc(db('owner9'), `classes/${DEL}`), { deletingAtMillis: 0 }));
    await assertFails(updateDoc(doc(db('owner9'), `classes/${DEL}`), { deletingAtMillis: now() }));
    await assertFails(updateDoc(doc(db('stu0'), `classes/${DEL}`), { deletingAtMillis: 0 }));
  });

  await test('While the class is being deleted the books are closed: no records, voids, charges, pay-outs or summary', async () => {
    const t = db('stu0');
    await assertFails(addRecordBatch(t, payment('stu0', 'stu3', 100), { classId: DEL }).b.commit());
    await assertFails(addRecordBatch(t, payment('stu0', 'stu3', 100), { classId: DEL, summary: false }).b.commit());
    await assertFails(voidBatch(t, 'stu0', del.pay, { classId: DEL }).commit());
    await assertFails(chargeBatch(t, 'stu0', { classId: DEL, batchId: 'c10', students: ['stu3'] }).b.commit());
    await assertFails(voidPayoutBatch(t, 'stu0', del.charge.payout, 'c9', { classId: DEL }).commit());
    await assertFails(setDoc(doc(t, `classes/${DEL}/summary/fund`), { cashOnHandCentavos: 0, waitingPayoutCentavos: 0, balancesTotalCentavos: 0, recordCount: 0, updatedAtMillis: now() }));
    await assertFails(setDoc(doc(t, `classes/${DEL}/openingBalances/stu6`), { amountCentavos: 100, note: '' }));
  });

  await test('While the class is being deleted nobody new asks to join or is approved', async () => {
    await assertFails(requestJoin(db('late10'), 'late10', { classId: DEL, code: DEL_CODE }));
    await assertFails(approveBatch(db('owner9'), 'owner9', 'late9', { classId: DEL }).commit());
  });

  await test('While the class is being deleted, only the owner deletes its ledger', async () => {
    await assertFails(deleteDoc(doc(db('stu0'), del.pay.ref.path)));
    await assertFails(deleteDoc(doc(db('stu0'), `classes/${DEL}/charges/c9`)));
    await assertFails(deleteDoc(doc(db('stu0'), `classes/${DEL}/summary/fund`)));
    await assertFails(deleteDoc(doc(db('stu1'), `classes/${DEL}/progress/stu2`)));
  });

  await test('The owner deletes the records, charges, summary, opening balances, requests, schedule, contents, courses, some done marks and the photo', async () => {
    const owner = db('owner9');
    const first = writeBatch(owner);
    for (const r of [del.pay, del.wd, ...del.charge.shares, del.charge.payout]) first.delete(doc(owner, r.ref.path));
    for (const p of ['charges/c9', 'summary/fund', 'openingBalances/stu5', 'joinRequests/late9', 'schedule/s1', 'contents/c1', 'courses/or']) {
      first.delete(doc(owner, `classes/${DEL}/${p}`));
    }
    for (const s of students.slice(0, 15)) first.delete(doc(owner, `classes/${DEL}/progress/${s}`));
    first.delete(doc(owner, `classPhotos/${DEL}`));
    await assertSucceeds(first.commit());
  });

  /** The last batch: the remaining done marks, every member, the roles, the invite and the class itself. */
  function lastDeleteBatch(store, ownerUid, { keepOwnMember = false, leaveMember = null } = {}) {
    const b = writeBatch(store);
    b.delete(doc(store, `invites/${DEL_CODE}`));
    for (const s of students) {
      if (s !== leaveMember) b.delete(doc(store, `classes/${DEL}/members/${s}`));
    }
    for (const s of students.slice(15)) b.delete(doc(store, `classes/${DEL}/progress/${s}`));
    for (const id of Object.keys(ROLES)) b.delete(doc(store, `classes/${DEL}/roles/${id}`));
    if (!keepOwnMember) b.delete(doc(store, `classes/${DEL}/members/${ownerUid}`));
    b.delete(doc(store, `classes/${DEL}`));
    return b;
  }

  await test('A student cannot delete the class', async () => {
    const store = db('stu1');
    const b = writeBatch(store);
    b.delete(doc(store, `classes/${DEL}/members/stu1`));
    b.delete(doc(store, `classes/${DEL}`));
    await assertFails(b.commit());
  });

  await test('The Mayor cannot delete the class and keep their own member entry', () =>
    assertFails(lastDeleteBatch(db('owner9'), 'owner9', { keepOwnMember: true }).commit()));

  await test('The Mayor deletes the class with its members, roles and invite in one last batch', () =>
    assertSucceeds(lastDeleteBatch(db('owner9'), 'owner9', { leaveMember: 'stu29' }).commit()));

  await test('After the class is deleted, a former student cannot read it and sees they are no longer a member', async () => {
    const store = db('stu1');
    await assertFails(getDoc(doc(store, `classes/${DEL}`)));
    const me = await assertSucceeds(getDoc(doc(store, `classes/${DEL}/members/stu1`)));
    expect(!me.exists(), 'member entry still exists');
    expect((await assertSucceeds(myMemberEntries(store, 'stu1'))).size === 0, 'the class should be off "My classes"');
  });

  await test('A member entry a deleted class left behind can be removed by its owner only', async () => {
    const s = db('stu29');
    const mine = await assertSucceeds(myMemberEntries(s, 'stu29'));
    expect(mine.size === 1, 'the left-over entry should show');
    // The app sees the class is gone (the entry still makes them a "member", so the read is allowed but empty).
    const room = await assertSucceeds(getDoc(doc(s, `classes/${DEL}`)));
    expect(!room.exists(), 'the class should be gone');
    await assertFails(deleteDoc(doc(db('stu28'), `classes/${DEL}/members/stu29`)));
    await assertSucceeds(deleteDoc(doc(s, `classes/${DEL}/members/stu29`)));
  });

  await test('A class that is not being deleted cannot be deleted, even in a complete last batch', async () => {
    const owner = db('owner8');
    await assertSucceeds(createClassBatch(owner, 'owner8', { classId: 'tiny', code: 'TTTTTT' }).commit());
    const lastTiny = () => {
      const b = writeBatch(owner);
      for (const id of Object.keys(ROLES)) b.delete(doc(owner, `classes/tiny/roles/${id}`));
      b.delete(doc(owner, 'classes/tiny/members/owner8'));
      b.delete(doc(owner, 'invites/TTTTTT'));
      b.delete(doc(owner, 'classes/tiny'));
      return b;
    };
    await assertFails(lastTiny().commit());
    await assertSucceeds(updateDoc(doc(owner, 'classes/tiny'), { deletingAtMillis: now() }));
    await assertSucceeds(lastTiny().commit());
  });

  // ==================================================================== Groupings, shared groupings, polls, rollover

  /** A class seeded with rules off: the owner as Mayor and the given members. */
  async function seedClass(classId, code, owner, members) {
    await admin(async (s) => {
      await createClassBatch(s, owner, { classId, code }).commit();
      for (const m of members) await setDoc(doc(s, `classes/${classId}/members/${m}`), memberData(m, { approvedByUid: owner }));
    });
  }

  const SLOTS = [{ id: 'g1', name: 'Group 1', maxSize: 3 }, { id: 'g2', name: 'Group 2', maxSize: 3 }];
  /** A grouping in the stored form: Ben sits in Group 1 and leads it. */
  function groupingData(extra = {}) {
    return {
      title: 'Lab groups', courseId: '', note: '', selfJoin: true, locked: false, hasLeader: false,
      groups: SLOTS, seats: { ben: { g: 'g1', at: 1 } }, meta: {}, leaders: { g1: 'ben' }, requests: {}, guests: {}, act: '',
      createdByUid: 'gmayor', createdAtMillis: now(), updatedAtMillis: now(), ...extra,
    };
  }

  await seedClass('grp', 'GGGGGG', 'gmayor', ['ann', 'ben', 'cat']);
  await admin(async (s) => {
    await setDoc(doc(s, 'classes/grp/groupings/open'), groupingData());
    await setDoc(doc(s, 'classes/grp/groupings/led'), groupingData({ hasLeader: true }));
  });
  const grp = (uid, id = 'open') => doc(db(uid), `classes/grp/groupings/${id}`);

  await test('Groupings: a student takes a seat in an empty group and leads it', async () => {
    await assertSucceeds(updateDoc(grp('ann'), { 'seats.ann': { g: 'g2', at: now() }, 'leaders.g2': 'ann', act: '', updatedAtMillis: now() }));
  });

  await test('Groupings: a student cannot move or remove a classmate, or take over their lead', async () => {
    await assertFails(updateDoc(grp('ann'), { 'seats.ben': deleteField(), updatedAtMillis: now() }));
    await assertFails(updateDoc(grp('ann'), { 'seats.ben': { g: 'g2', at: now() }, updatedAtMillis: now() }));
    await assertFails(updateDoc(grp('cat'), { 'seats.cat': { g: 'g1', at: now() }, 'leaders.g1': 'cat', updatedAtMillis: now() }));
    // The nearest allowed change: Cat joins Group 1 without touching its leader.
    await assertSucceeds(updateDoc(grp('cat'), { 'seats.cat': { g: 'g1', at: now() }, updatedAtMillis: now() }));
  });

  await test('Groupings: a student cannot rename groups or change their caps', async () => {
    await assertFails(updateDoc(grp('ann'), { groups: [{ id: 'g1', name: 'Mine', maxSize: 99 }, SLOTS[1]], updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(doc(db('gmayor'), 'classes/grp/groupings/open'), { groups: [{ id: 'g1', name: 'Mine', maxSize: 4 }, SLOTS[1]], updatedAtMillis: now() }));
  });

  await test('Groupings: a guest goes only into the student\'s own group, named in act', async () => {
    const guest = (g) => ({ g, name: 'Irregular', tag: 'G2', by: 'ann', at: now() });
    await assertFails(updateDoc(grp('ann'), { 'guests.x1': guest('g1'), act: 'x1', updatedAtMillis: now() }));
    await assertFails(updateDoc(grp('ann'), { 'guests.x1': guest('g2'), act: 'other', updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(grp('ann'), { 'guests.x1': guest('g2'), act: 'x1', updatedAtMillis: now() }));
    await assertFails(updateDoc(grp('cat'), { 'guests.x1': deleteField(), act: 'x1', updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(grp('ann'), { 'guests.x1': deleteField(), act: 'x1', updatedAtMillis: now() }));
  });

  await test('Groupings: nothing changes for students once the grouping is locked', async () => {
    await assertSucceeds(updateDoc(doc(db('gmayor'), 'classes/grp/groupings/open'), { locked: true, updatedAtMillis: now() }));
    await assertFails(updateDoc(grp('ann'), { 'seats.ann': deleteField(), updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(doc(db('gmayor'), 'classes/grp/groupings/open'), { locked: false, updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(grp('ann'), { 'seats.ann': deleteField(), 'leaders.g2': deleteField(), updatedAtMillis: now() }));
  });

  await test('Groupings with leaders: a led group is joined by asking, and only its leader decides', async () => {
    await assertFails(updateDoc(grp('cat', 'led'), { 'seats.cat': { g: 'g1', at: now() }, updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(grp('cat', 'led'), { 'requests.cat': { g: 'g1', name: 'Cat', classId: 'grp', tag: '', at: now() }, act: 'cat', updatedAtMillis: now() }));
    const approve = (uid) => updateDoc(grp(uid, 'led'), { 'seats.cat': { g: 'g1', at: now() }, 'requests.cat': deleteField(), act: 'cat', updatedAtMillis: now() });
    await assertFails(approve('ann'));
    await assertFails(updateDoc(grp('ben', 'led'), { 'seats.cat': { g: 'g2', at: now() }, 'requests.cat': deleteField(), act: 'cat', updatedAtMillis: now() }));
    await assertSucceeds(approve('ben'));
  });

  // ---- Shared groupings: linking by code
  await seedClass('grp2', 'HHHHHH', 'pmayor', ['pam']);
  await admin(async (s) => {
    const shared = (id, code) => ({
      ...groupingData({ title: id }), hostClassId: 'grp', shareCode: code, linkedClassIds: ['grp'],
      linkedClasses: { grp: { name: 'G1', tag: 'G1', courseId: '' } },
    });
    const a = shared('sh', 'GRP-AAAAAAAA');
    const b = shared('other', 'GRP-BBBBBBBB');
    delete a.courseId;
    delete b.courseId;
    await setDoc(doc(s, 'sharedGroupings/sh'), a);
    await setDoc(doc(s, 'sharedGroupings/other'), b);
    await setDoc(doc(s, 'groupingInvites/GRP-AAAAAAAA'), { sharedId: 'sh', title: 'sh', hostClassId: 'grp', hostClassName: 'G1' });
    await setDoc(doc(s, 'groupingInvites/GRP-BBBBBBBB'), { sharedId: 'other', title: 'other', hostClassId: 'grp', hostClassName: 'G1' });
  });
  const link = (uid, code, extra = {}) =>
    updateDoc(doc(db(uid), 'sharedGroupings/sh'), {
      linkedClassIds: ['grp', 'grp2'], 'linkedClasses.grp2': { name: 'G2', tag: 'G2', courseId: '' }, linkCode: code, updatedAtMillis: now(), ...extra,
    });

  await test('Shared groupings: a partner class links only with this grouping\'s own code', async () => {
    await assertFails(getDoc(doc(db('pmayor'), 'sharedGroupings/sh')));
    await assertFails(link('pmayor', 'GRP-BBBBBBBB'));
    await assertFails(link('pmayor', 'GRP-NOSUCH1'));
    await assertFails(link('pmayor', 'GRP-AAAAAAAA', { 'linkedClasses.grp': { name: 'Renamed', tag: 'X', courseId: '' } }));
    await assertFails(link('pam', 'GRP-AAAAAAAA'));
    await assertSucceeds(link('pmayor', 'GRP-AAAAAAAA'));
    await assertSucceeds(getDoc(doc(db('pam'), 'sharedGroupings/sh')));
  });

  await test('Shared groupings: a partner student changes only their own seat', async () => {
    const sh = (uid) => doc(db(uid), 'sharedGroupings/sh');
    await assertFails(updateDoc(sh('pam'), { 'seats.ben': deleteField(), updatedAtMillis: now() }));
    await assertSucceeds(updateDoc(sh('pam'), { 'seats.pam': { g: 'g2', at: now() }, 'leaders.g2': 'pam', 'meta.pam': { name: 'Pam', classId: 'grp2', tag: 'G2' }, updatedAtMillis: now() }));
  });

  // ---- Anonymous polls
  await admin(async (s) => {
    const poll = (anonymous) => ({
      question: 'When?', options: ['Mon', 'Tue', 'Wed'], courseId: '', multi: false, maxChoices: 1, anonymous,
      closesAtMillis: 0, closed: false, tally: {}, voters: 0, createdByUid: 'gmayor', createdAtMillis: now(),
    });
    await setDoc(doc(s, 'classes/grp/polls/anon'), poll(true));
    await setDoc(doc(s, 'classes/grp/polls/open'), poll(false));
  });
  const ballot = (uid, choices) => ({ pollId: 'anon', uid, choices, votedAtMillis: now() });
  const vote = (uid, choices, tally, voters) => {
    const s = db(uid);
    const b = writeBatch(s);
    b.set(doc(s, `classes/grp/pollBallots/anon_${uid}`), ballot(uid, choices));
    const counts = Object.fromEntries(Object.entries(tally).map(([k, v]) => [`tally.${k}`, increment(v)]));
    if (Object.keys(counts).length || voters) b.update(doc(s, 'classes/grp/polls/anon'), { ...counts, ...(voters ? { voters: increment(voters) } : {}) });
    return b.commit();
  };

  await test('Anonymous polls: the count moves by exactly the ballot, and ballots stay private', async () => {
    await assertFails(vote('ann', [1], {}, 0));
    await assertFails(vote('ann', [1], { 1: 2 }, 1));
    await assertFails(vote('ann', [1], { 0: 1 }, 1));
    await assertSucceeds(vote('ann', [1], { 1: 1 }, 1));
    await assertFails(getDoc(doc(db('ben'), 'classes/grp/pollBallots/anon_ann')));
    await assertFails(getDoc(doc(db('gmayor'), 'classes/grp/pollBallots/anon_ann')));
    await assertSucceeds(getDoc(doc(db('ann'), 'classes/grp/pollBallots/anon_ann')));
    await assertSucceeds(vote('ann', [2], { 1: -1, 2: 1 }, 0));
    const p = await assertSucceeds(getDoc(doc(db('ben'), 'classes/grp/polls/anon')));
    expect(p.data().tally['1'] === 0 && p.data().tally['2'] === 1 && p.data().voters === 1, 'tally should be {1: 0, 2: 1}, 1 voter');
  });

  await test('Anonymous polls: no open vote document, and nobody edits the count on its own', async () => {
    await assertFails(setDoc(doc(db('ben'), 'classes/grp/pollVotes/anon_ben'), ballot('ben', [0])));
    await assertFails(updateDoc(doc(db('ben'), 'classes/grp/polls/anon'), { 'tally.0': increment(5) }));
    await assertSucceeds(setDoc(doc(db('ben'), 'classes/grp/pollVotes/open_ben'), { ...ballot('ben', [0]), pollId: 'open' }));
  });

  await test('Polls: an officer can reopen an expired poll by clearing closesAtMillis; a member cannot', async () => {
    await admin((s) =>
      setDoc(doc(s, 'classes/grp/polls/expired'), {
        question: 'Late?', options: ['Yes', 'No'], courseId: '', multi: false, maxChoices: 1, anonymous: false,
        closesAtMillis: now() - 60000, closed: false, tally: {}, voters: 0, createdByUid: 'gmayor', createdAtMillis: now(),
      }),
    );
    await assertFails(setDoc(doc(db('ann'), 'classes/grp/pollVotes/expired_ann'), { ...ballot('ann', [0]), pollId: 'expired' }));
    await assertFails(updateDoc(doc(db('ann'), 'classes/grp/polls/expired'), { closed: false, closesAtMillis: 0 }));
    await assertSucceeds(updateDoc(doc(db('gmayor'), 'classes/grp/polls/expired'), { closed: false, closesAtMillis: 0 }));
    await assertSucceeds(setDoc(doc(db('ann'), 'classes/grp/pollVotes/expired_ann'), { ...ballot('ann', [0]), pollId: 'expired' }));
  });

  // ---- Semester rollover
  await seedClass('oldsem', 'OOOOOO', 'rmayor', ['dan']);
  await seedClass('elsewhere', 'EEEEEE', 'xmayor', ['eve']);

  await test('Rollover: the Mayor copies members of the class being rolled over, and nobody else', async () => {
    const m = db('rmayor');
    const b = createClassBatch(m, 'rmayor', { classId: 'newsem', code: 'NNNNNN' });
    b.set(doc(m, 'classes/newsem/rollover/source'), { fromClassId: 'oldsem' });
    await assertSucceeds(b.commit());
    const copy = (uid) => setDoc(doc(m, `classes/newsem/members/${uid}`), { uid, name: nameOf(uid), roleId: 'member', joinedAtMillis: now(), excludedCourseIds: [], approvedByUid: 'rmayor' });
    await assertFails(copy('eve'));
    await assertSucceeds(copy('dan'));
  });

  await test('Rollover: a class cannot claim to come from someone else\'s class', async () => {
    const x = db('xmayor');
    const b = createClassBatch(x, 'xmayor', { classId: 'fake', code: 'FFFFFF' });
    b.set(doc(x, 'classes/fake/rollover/source'), { fromClassId: 'oldsem' });
    await assertFails(b.commit());
  });

  // ---- Partner classes & shared cross-class polls
  await test('Partners: mutual partner records can be created via a shared grouping or link code, not by outsiders', async () => {
    const partnerDoc = (id, name, tag, extra = {}) => ({
      partnerClassId: id, name, tag, accentColor: '#CC4A0A', linkedAtMillis: now(), ...extra,
    });
    // Outsider cannot add themselves as a partner of grp2.
    await assertFails(setDoc(doc(db('xmayor'), 'classes/grp2/partners/elsewhere'), partnerDoc('elsewhere', 'Elsewhere', 'EL')));
    // gmayor (host of sharedGroupings/sh, which links grp + grp2) can register grp2 in grp and grp in grp2 via sharedGroupingId.
    await assertSucceeds(setDoc(doc(db('gmayor'), 'classes/grp/partners/grp2'), partnerDoc('grp2', 'G2', 'G2')));
    await assertSucceeds(setDoc(doc(db('gmayor'), 'classes/grp2/partners/grp'), partnerDoc('grp', 'G1', 'G1', { sharedGroupingId: 'sh' })));
    // Non-officer student cannot add partners.
    await assertFails(setDoc(doc(db('ann'), 'classes/grp/partners/elsewhere'), partnerDoc('elsewhere', 'Elsewhere', 'EL')));
  });

  await test('Shared polls: host officer can create a shared poll with a trusted partner, not an untrusted class', async () => {
    const sharedPollData = (ids, anonymous = false) => ({
      question: 'Joint schedule?', options: ['Fri', 'Sat'], multi: false, maxChoices: 1, anonymous,
      closesAtMillis: 0, closed: false, tally: {}, voters: 0,
      hostClassId: 'grp', linkedClassIds: ids,
      linkedClasses: { grp: { name: 'G1', tag: 'G1' }, grp2: { name: 'G2', tag: 'G2' } },
      createdByUid: 'gmayor', createdAtMillis: now(),
    });
    // Untrusted class 'elsewhere' is rejected.
    await assertFails(setDoc(doc(db('gmayor'), 'sharedPolls/sp_bad'), sharedPollData(['grp', 'elsewhere'])));
    // Trusted partner 'grp2' succeeds, along with links in both classes.
    const g = db('gmayor');
    const b = writeBatch(g);
    b.set(doc(g, 'sharedPolls/sp_open'), sharedPollData(['grp', 'grp2'], false));
    b.set(doc(g, 'classes/grp/sharedPollLinks/sp_open'), { pollId: 'sp_open', fromClassId: 'grp', linkedAtMillis: now() });
    b.set(doc(g, 'classes/grp2/sharedPollLinks/sp_open'), { pollId: 'sp_open', fromClassId: 'grp', linkedAtMillis: now() });
    await assertSucceeds(b.commit());
    // Untrusted class cannot create a sharedPollLink in grp2.
    await assertFails(setDoc(doc(db('xmayor'), 'classes/grp2/sharedPollLinks/sp_evil'), { pollId: 'sp_evil', fromClassId: 'elsewhere', linkedAtMillis: now() }));
  });

  await test('Shared polls: partner students can vote on open and anonymous shared polls, outsiders cannot', async () => {
    // Open shared poll: pam (in grp2) can read and vote; eve (outsider) cannot.
    await assertFails(getDoc(doc(db('eve'), 'sharedPolls/sp_open')));
    await assertSucceeds(getDoc(doc(db('pam'), 'sharedPolls/sp_open')));
    await assertFails(setDoc(doc(db('eve'), 'sharedPolls/sp_open/votes/eve'), { pollId: 'sp_open', uid: 'eve', choices: [0], votedAtMillis: now() }));
    await assertSucceeds(setDoc(doc(db('pam'), 'sharedPolls/sp_open/votes/pam'), { pollId: 'sp_open', uid: 'pam', choices: [1], votedAtMillis: now() }));
    await assertSucceeds(setDoc(doc(db('ann'), 'sharedPolls/sp_open/votes/ann'), { pollId: 'sp_open', uid: 'ann', choices: [0], votedAtMillis: now() }));

    // Anonymous shared poll: create and cast a private ballot with matched tally.
    await assertSucceeds(setDoc(doc(db('gmayor'), 'sharedPolls/sp_anon'), {
      question: 'Secret vote?', options: ['A', 'B'], multi: false, maxChoices: 1, anonymous: true,
      closesAtMillis: 0, closed: false, tally: {}, voters: 0,
      hostClassId: 'grp', linkedClassIds: ['grp', 'grp2'],
      linkedClasses: { grp: { name: 'G1', tag: 'G1' }, grp2: { name: 'G2', tag: 'G2' } },
      createdByUid: 'gmayor', createdAtMillis: now(),
    }));
    const pamDb = db('pam');
    const anonVote = writeBatch(pamDb);
    anonVote.set(doc(pamDb, 'sharedPolls/sp_anon/ballots/pam'), { pollId: 'sp_anon', uid: 'pam', choices: [0], votedAtMillis: now() });
    anonVote.update(doc(pamDb, 'sharedPolls/sp_anon'), { 'tally.0': increment(1), voters: increment(1) });
    await assertSucceeds(anonVote.commit());
    await assertFails(getDoc(doc(db('gmayor'), 'sharedPolls/sp_anon/ballots/pam')));
    await assertSucceeds(getDoc(doc(db('pam'), 'sharedPolls/sp_anon/ballots/pam')));
  });

  await test('Partner notices: trusted partner officer can queue a class notice, untrusted officer cannot', async () => {
    const notice = (fromClassId, uid) => ({
      kind: 'ANNOUNCEMENT', audience: 'CLASS', audienceId: '', title: 'New poll: Joint schedule?', body: 'Fri · Sat',
      createdByUid: uid, createdAtMillis: now(), fromClassId,
    });
    await assertSucceeds(setDoc(doc(db('gmayor'), 'classes/grp2/outbox/p1'), notice('grp', 'gmayor')));
    await assertFails(setDoc(doc(db('xmayor'), 'classes/grp2/outbox/p2'), notice('elsewhere', 'xmayor')));
    await assertFails(setDoc(doc(db('ann'), 'classes/grp2/outbox/p3'), notice('grp', 'ann')));
  });

  await env.cleanup();

  // ---------------------------------------------------------------- Report

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.error}`}`);
  console.log(`\n${results.length - failed.length} of ${results.length} rule tests passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

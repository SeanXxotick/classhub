// Tests for ../firestore.rules against the local Firestore emulator.
// Run from the project folder:  firebase emulators:exec --only firestore --project demo-classhub "node firestore-tests/rules.test.js"
// Each test acts out what the app really writes, as a given user, and checks it is allowed or blocked.

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, writeBatch, deleteField,
} = require('firebase/firestore');

const CLASS = 'class1';
const CODE = 'K7M4QX';
const PERMS = ['RECORDS_MANAGE', 'SCHEDULE_MANAGE', 'MEMBERS_MANAGE', 'ROLES_MANAGE', 'CLASS_SETTINGS', 'CONTENTS_MANAGE'];

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

const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const roles = {
  mayor: { id: '', name: 'Mayor', colorHex: '#7C3AED', permissions: PERMS, locked: true },
  treasurer: { id: '', name: 'Treasurer', colorHex: '#15803D', permissions: ['RECORDS_MANAGE'], locked: false },
  secretary: { id: '', name: 'Secretary', colorHex: '#3730A3', permissions: ['SCHEDULE_MANAGE', 'CONTENTS_MANAGE'], locked: false },
  member: { id: '', name: 'Member', colorHex: '#6B768A', permissions: [], locked: false },
};

/** Exactly the batch ClassRepository.createClass writes. */
function createClassBatch(store, owner, classId = CLASS, code = CODE) {
  const b = writeBatch(store);
  b.set(doc(store, `classes/${classId}`), {
    id: '', name: 'BSM CS 3A', description: '', ownerUid: owner, accentColor: '#0F766E', inviteCode: code,
    defaultRoleId: 'member', ledgerEnabled: true, scheduleEnabled: true, contentsEnabled: true, createdAtMillis: 1,
  });
  for (const [id, r] of Object.entries(roles)) b.set(doc(store, `classes/${classId}/roles/${id}`), r);
  b.set(doc(store, `classes/${classId}/members/${owner}`), { id: '', name: 'Juan', roleId: 'mayor', joinedAtMillis: 1, excludedCourseIds: [] });
  b.set(doc(store, `invites/${code}`), { classId, className: 'BSM CS 3A', defaultRoleId: 'member' });
  b.set(doc(store, `users/${owner}/memberships/${classId}`), { classId: '', className: 'BSM CS 3A', joinedAtMillis: 1 });
  return b;
}

/** Exactly the batch ClassRepository.joinClass writes. */
function joinBatch(store, uid, { code = CODE, roleId = 'member', classId = CLASS } = {}) {
  const b = writeBatch(store);
  b.set(doc(store, `classes/${classId}/members/${uid}`), { name: uid, roleId, joinedAtMillis: 2, excludedCourseIds: [], joinCode: code });
  b.set(doc(store, `users/${uid}/memberships/${classId}`), { classId: '', className: 'BSM CS 3A', joinedAtMillis: 2 });
  return b;
}

function record(type, amount, by, extra = {}) {
  return {
    id: '', type, amountCentavos: amount, memberId: '', memberName: '', note: 'Quiz - OR', dateMillis: 3,
    batchId: '', courseId: '', createdByUid: by, settlesBatchId: '', paidTo: '', ...extra,
  };
}

async function main() {
  env = await initializeTestEnvironment({
    projectId: 'demo-classhub',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });

  // ---------------------------------------------------------------- Accounts and classes

  await test('A user can write their own profile', () =>
    assertSucceeds(setDoc(doc(db('mayor'), 'users/mayor'), { displayName: 'Juan', email: 'juan@example.com' })));

  await test('A user cannot write someone else\'s profile', () =>
    assertFails(setDoc(doc(db('mayor'), 'users/student'), { displayName: 'Hacker' })));

  await test('Signed-out users cannot read anything', () =>
    assertFails(getDoc(doc(anon(), 'users/mayor'))));

  await test('Creating a class (class, default roles, Mayor, invite, My classes) succeeds', () =>
    assertSucceeds(createClassBatch(db('mayor'), 'mayor').commit()));

  await test('Creating a class that names someone else as owner is blocked', () =>
    assertFails(createClassBatch(db('outsider'), 'mayor', 'class2', 'ZZZZZZ').commit()));

  await test('An outsider cannot read the class', () =>
    assertFails(getDoc(doc(db('outsider'), `classes/${CLASS}`))));

  await test('An outsider cannot read the members list', () =>
    assertFails(getDocs(collection(db('outsider'), `classes/${CLASS}/members`))));

  await test('Anyone signed in can look up one invite code', () =>
    assertSucceeds(getDoc(doc(db('student'), `invites/${CODE}`))));

  await test('Nobody can list all invite codes', () =>
    assertFails(getDocs(collection(db('student'), 'invites'))));

  // ---------------------------------------------------------------- Joining

  await test('Joining with a wrong code is blocked', () =>
    assertFails(joinBatch(db('student'), 'student', { code: 'WRONG1' }).commit()));

  await test('Joining as Treasurer instead of Member is blocked', () =>
    assertFails(joinBatch(db('student'), 'student', { roleId: 'treasurer' }).commit()));

  await test('Joining as someone else is blocked', async () => {
    const store = db('student');
    await assertFails(setDoc(doc(store, `classes/${CLASS}/members/victim`), { name: 'x', roleId: 'member', joinedAtMillis: 2, excludedCourseIds: [], joinCode: CODE }));
  });

  await test('Joining with the right code as Member succeeds', () =>
    assertSucceeds(joinBatch(db('student'), 'student').commit()));

  await test('A second student joins', () =>
    assertSucceeds(joinBatch(db('maria'), 'maria').commit()));

  await test('Joining again while already in the class is blocked (cannot reset a role)', () =>
    assertFails(joinBatch(db('student'), 'student').commit()));

  await test('A member can read the class, members and roles', async () => {
    const store = db('student');
    await assertSucceeds(getDoc(doc(store, `classes/${CLASS}`)));
    await assertSucceeds(getDocs(collection(store, `classes/${CLASS}/members`)));
    await assertSucceeds(getDocs(collection(store, `classes/${CLASS}/roles`)));
  });

  // ---------------------------------------------------------------- Roles and members

  await test('A Member cannot promote themselves', () =>
    assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/members/student`), { roleId: 'treasurer' })));

  await test('A Member cannot edit roles', () =>
    assertFails(updateDoc(doc(db('student'), `classes/${CLASS}/roles/member`), { permissions: PERMS })));

  await test('The Mayor makes Maria the Treasurer', () =>
    assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/maria`), { roleId: 'treasurer' })));

  await test('Nobody can be given the locked Mayor role', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { roleId: 'mayor' })));

  await test('The Mayor cannot change their own role', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/mayor`), { roleId: 'member' })));

  await test('The locked Mayor role cannot be edited, even by the Mayor', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}/roles/mayor`), { name: 'King' })));

  await test('A new role cannot be created as locked', () =>
    assertFails(setDoc(doc(db('mayor'), `classes/${CLASS}/roles/fake`), { id: '', name: 'Fake', colorHex: '#000000', permissions: PERMS, locked: true })));

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

  await test('The default Member role cannot be deleted', () =>
    assertFails(deleteDoc(doc(db('mayor'), `classes/${CLASS}/roles/member`))));

  await test('A Treasurer cannot change anyone\'s role', () =>
    assertFails(updateDoc(doc(db('maria'), `classes/${CLASS}/members/student`), { roleId: 'secretary' })));

  await test('The Mayor sets which courses a student takes', () =>
    assertSucceeds(updateDoc(doc(db('mayor'), `classes/${CLASS}/members/student`), { excludedCourseIds: ['or'] })));

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

  await test('Nobody can change the class owner', () =>
    assertFails(updateDoc(doc(db('mayor'), `classes/${CLASS}`), { ownerUid: 'student' })));

  await test('A Member cannot change class settings', () =>
    assertFails(updateDoc(doc(db('student'), `classes/${CLASS}`), { name: 'Hacked' })));

  await test('A Member cannot make a new invite code', async () => {
    const store = db('student');
    const b = writeBatch(store);
    b.delete(doc(store, `invites/${CODE}`));
    b.set(doc(store, 'invites/HACK22'), { classId: CLASS, className: 'x', defaultRoleId: 'member' });
    b.update(doc(store, `classes/${CLASS}`), { inviteCode: 'HACK22' });
    await assertFails(b.commit());
  });

  // ---------------------------------------------------------------- Ledger

  await test('A Member cannot add ledger records', () =>
    assertFails(addDoc(collection(db('student'), `classes/${CLASS}/records`), record('PAYMENT', 10000, 'student', { memberId: 'student' }))));

  await test('The Treasurer records a payment', () =>
    assertSucceeds(addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('PAYMENT', 10000, 'maria', { memberId: 'student', memberName: 'Student' }))));

  await test('The Treasurer charges 30 students and pays out in one batch', async () => {
    const store = db('maria');
    const b = writeBatch(store);
    for (let i = 0; i < 30; i++) {
      b.set(doc(collection(store, `classes/${CLASS}/records`)), record('CHARGE', 600, 'maria', { memberId: `s${i}`, batchId: 'quiz1' }));
    }
    b.set(doc(collection(store, `classes/${CLASS}/records`)), record('EXPENSE', 18000, 'maria', { settlesBatchId: 'quiz1', paidTo: 'Prof. Santos' }));
    await assertSucceeds(b.commit());
  });

  await test('A pay-out that does not settle a charge is blocked', () =>
    assertFails(addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('EXPENSE', 500, 'maria'))));

  await test('A charge without a batch is blocked', () =>
    assertFails(addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('CHARGE', 600, 'maria', { memberId: 'student' }))));

  await test('A zero or negative amount is blocked', async () => {
    await assertFails(addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('PAYMENT', 0, 'maria', { memberId: 'student' })));
    await assertFails(addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('PAYMENT', -500, 'maria', { memberId: 'student' })));
  });

  await test('Recording in someone else\'s name is blocked', () =>
    assertFails(addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('PAYMENT', 10000, 'mayor', { memberId: 'student' }))));

  await test('Records cannot be edited after saving', async () => {
    const ref = await addDoc(collection(db('maria'), `classes/${CLASS}/records`), record('PAYMENT', 5000, 'maria', { memberId: 'student' }));
    await assertFails(updateDoc(doc(db('maria'), ref.path), { amountCentavos: 1 }));
  });

  await test('Every member can read the ledger', () =>
    assertSucceeds(getDocs(collection(db('student'), `classes/${CLASS}/records`))));

  // ---------------------------------------------------------------- Schedule and done marks

  await test('A Member cannot add schedule items; the Mayor can', async () => {
    const item = { id: '', courseId: 'or', title: 'Midterm', kind: 'EXAM', dueMillis: 5, status: 'PENDING', note: '', createdByUid: 'mayor' };
    await assertFails(setDoc(doc(db('student'), `classes/${CLASS}/schedule/x`), item));
    await assertSucceeds(setDoc(doc(db('mayor'), `classes/${CLASS}/schedule/midterm`), item));
  });

  await test('A student marks an item done for themselves (and undoes it)', async () => {
    const store = db('student');
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/student`), { done: { midterm: 123 } }, { merge: true }));
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/student`), { done: { midterm: deleteField() } }, { merge: true }));
    await assertSucceeds(setDoc(doc(store, `classes/${CLASS}/progress/student`), { done: { midterm: 456 } }, { merge: true }));
  });

  await test('A student cannot mark items for someone else', () =>
    assertFails(setDoc(doc(db('student'), `classes/${CLASS}/progress/maria`), { done: { midterm: 1 } }, { merge: true })));

  await test('A student cannot see a classmate\'s marks', () =>
    assertFails(getDoc(doc(db('student'), `classes/${CLASS}/progress/maria`))));

  await test('A student can read their own marks', () =>
    assertSucceeds(getDoc(doc(db('student'), `classes/${CLASS}/progress/student`))));

  await test('The Mayor (manages schedule) can see everyone\'s marks', () =>
    assertSucceeds(getDocs(collection(db('mayor'), `classes/${CLASS}/progress`))));

  await test('A student cannot list everyone\'s marks', () =>
    assertFails(getDocs(collection(db('student'), `classes/${CLASS}/progress`))));

  await test('Extra fields in the marks document are blocked', () =>
    assertFails(setDoc(doc(db('maria'), `classes/${CLASS}/progress/maria`), { done: {}, grade: 100 })));

  // ---------------------------------------------------------------- Contents

  await test('A Member cannot add class contents; the Mayor can', async () => {
    const item = { id: '', courseId: 'or', title: 'Module 1', url: 'https://drive.google.com/x', kind: 'FILE', note: '', createdByUid: 'mayor', createdAtMillis: 1 };
    await assertFails(setDoc(doc(db('student'), `classes/${CLASS}/contents/x`), item));
    await assertSucceeds(setDoc(doc(db('mayor'), `classes/${CLASS}/contents/m1`), item));
    await assertSucceeds(getDocs(collection(db('student'), `classes/${CLASS}/contents`)));
  });

  // ---------------------------------------------------------------- Invite code and removing members

  await test('The Mayor makes a new invite code; the old code stops working', async () => {
    const store = db('mayor');
    const b = writeBatch(store);
    b.delete(doc(store, `invites/${CODE}`));
    b.set(doc(store, 'invites/NEW234'), { classId: CLASS, className: 'BSM CS 3A (1st Sem)', defaultRoleId: 'member' });
    b.update(doc(store, `classes/${CLASS}`), { inviteCode: 'NEW234' });
    await assertSucceeds(b.commit());
    await assertFails(joinBatch(db('late'), 'late', { code: CODE }).commit());
    await assertSucceeds(joinBatch(db('late'), 'late', { code: 'NEW234' }).commit());
  });

  await test('A Member cannot remove anyone', () =>
    assertFails(deleteDoc(doc(db('student'), `classes/${CLASS}/members/late`))));

  await test('The class owner cannot be removed', () =>
    assertFails(deleteDoc(doc(db('mayor'), `classes/${CLASS}/members/mayor`))));

  await test('The Mayor removes a student', () =>
    assertSucceeds(deleteDoc(doc(db('mayor'), `classes/${CLASS}/members/late`))));

  await test('A removed student loses access but can still see that they were removed', async () => {
    const store = db('late');
    await assertFails(getDoc(doc(store, `classes/${CLASS}`)));
    await assertFails(getDocs(collection(store, `classes/${CLASS}/records`)));
    const own = await assertSucceeds(getDoc(doc(store, `classes/${CLASS}/members/late`)));
    if (own.exists()) throw new Error('membership should be gone');
    await assertSucceeds(deleteDoc(doc(store, `users/late/memberships/${CLASS}`)));
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

/*
 * Fills the LOCAL emulators with a test account and two classes, so the screens can be looked at without
 * typing everything in. It only ever talks to 127.0.0.1 (Auth 9099, Firestore 8080), never the real project.
 * Invented names only. Run from web/ while the emulators are up:  npx vite-node scripts/seed-emulator.ts
 */
import { initializeApp } from 'firebase/app';
import { addDoc, collection, connectFirestoreEmulator, doc, initializeFirestore, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { createClass } from '../src/data/classes';
import { approveJoinRequest, requestToJoin } from '../src/data/membership';
import { addPayment, addWithdrawal, chargeStudents } from '../src/data/ledgerStore';
import { confirmClaim, manilaDay, newAnnouncement, newClaim, newMeeting, saveAnnouncement, saveAttendance, saveMeeting, sendClaim } from '../src/data/features';

const PROJECT = 'demo-classhub';
const PASSWORD = 'classhub123';
const DAY = 86_400_000;

let n = 0;
function as(uid: string): Firestore {
  const db = initializeFirestore(initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `seed-${n++}`), {});
  connectFirestoreEmulator(db, '127.0.0.1', 8080, { mockUserToken: { sub: uid, user_id: uid } });
  return db;
}

/** Creates a sign-in on the Auth emulator and the profile document. Returns the uid. */
async function account(first: string, last: string, email: string): Promise<{ uid: string; name: string }> {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = (await res.json()) as { localId?: string; error?: { message: string } };
  if (!body.localId) throw new Error(body.error?.message === 'EMAIL_EXISTS' ? 'The test accounts are already there. Nothing was added.' : `Could not create ${email}: ${body.error?.message}`);
  const name = `${first} ${last}`;
  await setDoc(doc(as(body.localId), 'users', body.localId), { displayName: name, firstName: first, middleInitial: '', lastName: last, email });
  return { uid: body.localId, name };
}

async function main() {
  const mayor = await account('Maya', 'Reyes', 'mayor@test.com');
  const student = await account('Paolo', 'Garcia', 'student@test.com');
  const others = [];
  for (const [i, [first, last]] of [['Ana', 'Lim'], ['Ben', 'Torres'], ['Carla', 'Mendoza'], ['Diego', 'Ramos'], ['Ella', 'Navarro'], ['Felix', 'Aquino']].entries()) {
    others.push(await account(first, last, `classmate${i + 1}@test.com`));
  }
  const m = as(mayor.uid);
  const now = Date.now();

  // ---- Class 1: a full class
  const { classId, inviteCode } = await createClass(m, mayor, { name: 'BSM CS 3A (Test)', description: '1st Semester' });
  const everyone = [student, ...others];
  for (const s of everyone) {
    await requestToJoin(as(s.uid), s, inviteCode);
    await approveJoinRequest(m, mayor.uid, classId, s.uid);
  }
  const members = [mayor, ...everyone];
  // The app sets this itself when a member opens the class; the classmates here never sign in.
  for (const s of members) {
    const [first, last] = s.name.split(' ');
    await updateDoc(doc(as(s.uid), 'classes', classId, 'members', s.uid), { sortName: `${last}, ${first}` });
  }

  const courseIds: string[] = [];
  for (const [name, color] of [['Operations Research', '#2563EB'], ['Software Engineering', '#DB2777'], ['Abstract Algebra', '#7C3AED']]) {
    courseIds.push((await addDoc(collection(m, 'classes', classId, 'courses'), { id: '', name, color })).id);
  }

  // Ledger: payments, a charge that was paid out, one withdrawal, one confirmed and one waiting claim.
  for (const [i, s] of members.entries()) {
    if (i === 3) continue; // one classmate has not paid, so they owe after the charge
    await addPayment(m, mayor.uid, classId, { memberId: s.uid, memberName: s.name, amountCentavos: i % 2 ? 30000 : 50000, note: 'Class fund', dateMillis: now - 12 * DAY });
  }
  await chargeStudents(m, mayor.uid, classId, {
    note: 'Class shirt',
    dateMillis: now - 6 * DAY,
    shares: members.map((s) => ({ memberId: s.uid, memberName: s.name, amountCentavos: 25000 })),
    payout: { paidTo: 'Shirt printer' },
  });
  await chargeStudents(m, mayor.uid, classId, {
    note: 'Operations Research handouts',
    courseId: courseIds[0],
    dateMillis: now - 2 * DAY,
    shares: members.map((s) => ({ memberId: s.uid, memberName: s.name, amountCentavos: 4500 })),
  });
  await addWithdrawal(m, mayor.uid, classId, { memberId: others[0].uid, memberName: others[0].name, amountCentavos: 10000, note: 'Refund', dateMillis: now - DAY });
  const paidId = await sendClaim(as(student.uid), student, classId, { amountCentavos: 20000, method: 'GCASH', reference: 'GC 1029 3847', note: 'November' });
  await confirmClaim(m, mayor.uid, classId, newClaim({ id: paidId, memberId: student.uid, memberName: student.name, amountCentavos: 20000, method: 'GCASH', reference: 'GC 1029 3847', note: 'November', createdAtMillis: now }));
  await sendClaim(as(student.uid), student, classId, { amountCentavos: 15000, method: 'MAYA', reference: 'MY 5566 7788' });
  await sendClaim(as(others[1].uid), others[1], classId, { amountCentavos: 30000, method: 'BANK', reference: 'BDO 0091' });

  // News
  await saveAnnouncement(m, mayor.uid, classId, newAnnouncement({ title: 'Class shirt sizes due Friday', body: 'Send your size to the Mayor.\nSmall, medium, large or extra large.', pinned: true }));
  await saveAnnouncement(m, mayor.uid, classId, newAnnouncement({ title: 'No uniform on Wednesday', body: 'Wear the organization shirt instead.' }));

  // Timetable: a meeting on every weekday, and two taken attendance sheets
  const meetings = [];
  for (let day = 1; day <= 6; day++) {
    const meeting = newMeeting({ id: `meet${day}`, courseId: courseIds[day % 3], dayOfWeek: day, startMinutes: 480 + (day % 2) * 150, endMinutes: 570 + (day % 2) * 150, room: `Room ${200 + day}` });
    await saveMeeting(m, classId, meeting);
    meetings.push(meeting);
    if (day % 2 === 0) await saveMeeting(m, classId, newMeeting({ id: `meet${day}b`, courseId: courseIds[(day + 1) % 3], dayOfWeek: day, startMinutes: 780, endMinutes: 870, room: 'Computer Lab 2' }));
  }
  for (const back of [7, 14]) {
    for (const meeting of meetings.slice(0, 3)) {
      const millis = now - back * DAY - ((manilaDay(now).dayOfWeek - meeting.dayOfWeek + 7) % 7) * DAY;
      await saveAttendance(m, mayor.uid, classId, manilaDay(millis).dateKey, meeting, { [student.uid]: back === 7 ? 'ABSENT' : 'LATE', [others[2].uid]: 'ABSENT', [others[4].uid]: back === 7 ? 'LATE' : 'PRESENT' });
    }
  }

  // Schedule and contents (the 1.x collections)
  const noon = (days: number) => new Date(new Date(now + days * DAY).setHours(12, 0, 0, 0)).getTime();
  const items = [
    ['Linear programming problem set', 'DEADLINE', 1, 0], ['Quiz 3: simplex method', 'QUIZ', 2, 0], ['Sprint 2 demo', 'FCO', 4, 1],
    ['Midterm exam', 'EXAM', 6, 2], ['Group theory recitation', 'RECITATION', 3, 2], ['Use case diagrams', 'DEADLINE', 9, 1],
  ] as const;
  for (const [title, kind, days, course] of items) {
    await addDoc(collection(m, 'classes', classId, 'schedule'), { id: '', courseId: courseIds[course], title, kind, dueMillis: noon(days), status: 'PENDING', note: '', createdByUid: mayor.uid });
  }
  const links = [
    ['Simplex method lecture', 'VIDEO', 'https://www.youtube.com/watch?v=example', 0], ['Course syllabus', 'FILE', 'https://example.com/syllabus.pdf', 1],
    ['Group theory notes', 'WEBSITE', 'https://example.com/group-theory', 2], ['Project template', 'FILE', 'https://example.com/template.docx', 1],
  ] as const;
  for (const [title, kind, url, course] of links) {
    await addDoc(collection(m, 'classes', classId, 'contents'), { id: '', courseId: courseIds[course], title, url, kind, note: '', createdByUid: mayor.uid, createdAtMillis: now });
  }

  // ---- Class 2: a small one, where the student account is the Mayor
  const second = await createClass(as(student.uid), student, { name: 'Math Society (Test)', description: 'Officers', accentColor: '#7C3AED' });
  await requestToJoin(m, mayor, second.inviteCode);
  await approveJoinRequest(as(student.uid), student.uid, second.classId, mayor.uid);
  await addPayment(as(student.uid), student.uid, second.classId, { memberId: mayor.uid, memberName: mayor.name, amountCentavos: 10000, note: 'Membership fee' });

  console.log(`Done.\n  Mayor:   mayor@test.com   / ${PASSWORD}\n  Student: student@test.com / ${PASSWORD}`);
}

main().then(() => process.exit(0), (e) => (console.error(String(e?.message ?? e)), process.exit(1)));

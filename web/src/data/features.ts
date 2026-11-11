import { queueNotice } from './notify';
import { collection, deleteDoc, deleteField, doc, getDocs, increment, query, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { Ledger } from '../domain/ledger';
import { nowMillis, newId } from './dataEnv';
import { UserError } from './errors';
import { fromDoc, useQueryList } from './live';
import { buildRecord } from './ledgerStore';
import { bumpSummary, explainRefusal, recordRef, withoutId } from './paths';
import type { Actor } from './classes';

/*
 * Payment claims (2.1), announcements (2.3) and the timetable (2.4): models, writes and live lists.
 * Shapes follow docs/PLAN-V2.md "Data model (v2)" and the rules in firestore.rules.
 */

// ---------------------------------------------------------------- Payment claims

export const CLAIM_METHODS = ['GCASH', 'MAYA', 'BANK', 'CASH', 'OTHER'] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];
export const CLAIM_METHOD_LABELS: Record<ClaimMethod, string> = { GCASH: 'GCash', MAYA: 'Maya', BANK: 'Bank transfer', CASH: 'Cash', OTHER: 'Other' };
export type ClaimStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface Claim {
  id: string;
  memberId: string;
  memberName: string;
  amountCentavos: number;
  method: ClaimMethod;
  reference: string;
  note: string;
  status: ClaimStatus;
  createdAtMillis: number;
  decidedByUid: string;
  decidedAtMillis: number;
  rejectReason: string;
  recordId: string;
  hasProof: boolean;
}

export const newClaim = (c: Partial<Claim>): Claim => ({
  id: '', memberId: '', memberName: '', amountCentavos: 0, method: 'GCASH', reference: '', note: '', status: 'PENDING',
  createdAtMillis: 0, decidedByUid: '', decidedAtMillis: 0, rejectReason: '', recordId: '', hasProof: false, ...c,
});

const sub = (db: Firestore, classId: string, name: string) => collection(db, 'classes', classId, name);
export const claimsCol = (db: Firestore, classId: string) => sub(db, classId, 'claims');

/** A student says they paid. It waits for a records manager. Returns the claim id. */
export async function sendClaim(
  db: Firestore, actor: Actor, classId: string, input: { amountCentavos: number; method: ClaimMethod; reference: string; note?: string },
): Promise<string> {
  if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0 || input.amountCentavos > 100_000_000) throw new UserError('AMOUNT_INVALID');
  const claim = newClaim({
    memberId: actor.uid, memberName: actor.name.trim(), amountCentavos: input.amountCentavos, method: input.method,
    reference: input.reference.trim().slice(0, 60), note: (input.note ?? '').trim().slice(0, 200), createdAtMillis: nowMillis(),
  });
  const id = newId();
  await explainRefusal(db, classId, () => setDoc(doc(claimsCol(db, classId), id), withoutId(claim)));
  void queueNotice(db, actor.uid, classId, {
    kind: 'CLAIM_SENT', audience: 'PERMISSION', audienceId: 'RECORDS_MANAGE',
    title: `${claim.memberName} sent a payment claim`, body: `₱${(input.amountCentavos / 100).toFixed(2)} by ${CLAIM_METHOD_LABELS[input.method]}. Open the Ledger to confirm it.`,
  });
  return id;
}

/** The student takes back a claim that is still waiting. */
export const cancelClaim = (db: Firestore, classId: string, claimId: string) => deleteDoc(doc(claimsCol(db, classId), claimId));

/** Confirms a waiting claim: the PAYMENT record, the claim and the fund summary change in one batch. */
export async function confirmClaim(db: Firestore, actorUid: string, classId: string, claim: Claim): Promise<string> {
  const recordId = newId();
  const now = nowMillis();
  const label = CLAIM_METHOD_LABELS[claim.method] + (claim.reference ? ` ${claim.reference}` : '');
  const record = buildRecord('PAYMENT', claim.amountCentavos, actorUid, {
    memberId: claim.memberId, memberName: claim.memberName, note: (claim.note ? `${label} · ${claim.note}` : label).slice(0, 200), claimId: claim.id,
  });
  // buildRecord clears claimId (records made by hand never have one); this record belongs to the claim.
  record.claimId = claim.id;
  const batch = writeBatch(db);
  batch.set(recordRef(db, classId, recordId), withoutId(record));
  batch.update(doc(claimsCol(db, classId), claim.id), { status: 'CONFIRMED', decidedByUid: actorUid, decidedAtMillis: now, recordId });
  bumpSummary(batch, db, classId, Ledger.summaryDelta(record));
  await explainRefusal(db, classId, () => batch.commit());
  void queueNotice(db, actorUid, classId, {
    kind: 'CLAIM_DECIDED', audience: 'USER', audienceId: claim.memberId,
    title: 'Your payment claim was confirmed', body: `₱${(claim.amountCentavos / 100).toFixed(2)} was added to your balance.`,
  });
  return recordId;
}

/** Rejects a waiting claim with a reason the student can read. */
export async function rejectClaim(db: Firestore, actorUid: string, classId: string, claimId: string, reason: string, memberId = ''): Promise<void> {
  const why = reason.trim().slice(0, 200);
  if (!why) throw new UserError('NAME_MISSING', 'Write the reason.');
  await explainRefusal(db, classId, () =>
    updateDoc(doc(claimsCol(db, classId), claimId), { status: 'REJECTED', decidedByUid: actorUid, decidedAtMillis: nowMillis(), rejectReason: why }),
  );
  if (memberId) void queueNotice(db, actorUid, classId, { kind: 'CLAIM_DECIDED', audience: 'USER', audienceId: memberId, title: 'Your payment claim was rejected', body: `Reason: ${why}` });
}

/** Every claim for a records manager; a student's own claims for everyone else. Newest first. */
export function useClaims(db: Firestore, classId: string, uid: string, enabled: boolean, manage: boolean) {
  const live = useQueryList<Claim>(
    `v2/claims/${classId}/${uid}/${enabled}/${manage}`,
    !enabled ? null : manage ? claimsCol(db, classId) : query(claimsCol(db, classId), where('memberId', '==', uid)),
    (d) => fromDoc(newClaim({}), d),
  );
  return { ...live, data: live.data ? [...live.data].sort((a, b) => b.createdAtMillis - a.createdAtMillis) : live.data };
}

// ---------------------------------------------------------------- Announcements

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdByUid: string;
  createdAtMillis: number;
  editedAtMillis: number;
  /** How many comments and replies were ever added (removed ones keep their place, so they count). */
  commentCount: number;
  lastCommentId: string;
  /** An officer switched comments off for this announcement. */
  commentsOff: boolean;
}

export const newAnnouncement = (a: Partial<Announcement>): Announcement => ({
  id: '', title: '', body: '', pinned: false, createdByUid: '', createdAtMillis: 0, editedAtMillis: 0, commentCount: 0, lastCommentId: '', commentsOff: false, ...a,
});

export const announcementsCol = (db: Firestore, classId: string) => sub(db, classId, 'announcements');

/** Posts a new announcement, or saves an edited one (ANNOUNCEMENTS_MANAGE). Returns its id. */
export async function saveAnnouncement(db: Firestore, actorUid: string, classId: string, post: Announcement): Promise<string> {
  const title = post.title.trim().slice(0, 120);
  if (!title) throw new UserError('NAME_MISSING', 'Give the announcement a title.');
  const body = post.body.trim().slice(0, 4000);
  if (!post.id) {
    const fresh = newAnnouncement({ title, body, pinned: post.pinned, commentsOff: post.commentsOff, createdByUid: actorUid, createdAtMillis: nowMillis() });
    const id = newId();
    await explainRefusal(db, classId, () => setDoc(doc(announcementsCol(db, classId), id), withoutId(fresh)));
    void queueNotice(db, actorUid, classId, { kind: 'ANNOUNCEMENT', audience: 'CLASS', title: `Announcement: ${title}`, body });
    return id;
  }
  await explainRefusal(db, classId, () =>
    updateDoc(doc(announcementsCol(db, classId), post.id), { title, body, pinned: post.pinned, commentsOff: post.commentsOff, editedAtMillis: nowMillis() }));
  return post.id;
}

export const setPinned = (db: Firestore, classId: string, postId: string, pinned: boolean) =>
  updateDoc(doc(announcementsCol(db, classId), postId), { pinned });

/** Deletes an announcement together with its comments (ANNOUNCEMENTS_MANAGE). */
export async function deleteAnnouncement(db: Firestore, classId: string, postId: string): Promise<void> {
  const comments = await getDocs(query(commentsCol(db, classId), where('postId', '==', postId)));
  for (let i = 0; i < comments.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of comments.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(doc(announcementsCol(db, classId), postId));
}

/** Pinned first, then newest. */
export function useAnnouncements(db: Firestore, classId: string, enabled: boolean) {
  const live = useQueryList<Announcement>(`v2/announcements/${classId}/${enabled}`, enabled ? announcementsCol(db, classId) : null, (d) => fromDoc(newAnnouncement({}), d));
  return {
    ...live,
    data: live.data ? [...live.data].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAtMillis - a.createdAtMillis) : live.data,
  };
}

export interface SeenMarks {
  id: string;
  announcements: Record<string, number>;
}

/** Marks announcements as opened by this student (one small document per student). */
export function markSeen(db: Firestore, classId: string, uid: string, postIds: string[]): Promise<void> {
  const now = nowMillis();
  const marks: Record<string, number> = {};
  for (const id of postIds) marks[id] = now;
  return setDoc(doc(db, 'classes', classId, 'seen', uid), { announcements: marks }, { merge: true });
}

export const useSeen = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<SeenMarks>(`v2/seen/${classId}/${enabled}`, enabled ? sub(db, classId, 'seen') : null, (d) => fromDoc<SeenMarks>({ id: '', announcements: {} }, d));

// ---------------------------------------------------------------- Comments and votes

/** A comment under an announcement. parentId is '' for a comment and the comment's id for a reply to it. */
export interface Comment {
  id: string;
  postId: string;
  parentId: string;
  uid: string;
  /** The writer's name when it was written; the screen prefers their current member name. */
  name: string;
  text: string;
  createdAtMillis: number;
  /** Not 0 once removed: the text is gone but the comment keeps its place. */
  removedAtMillis: number;
}

export const newComment = (c: Partial<Comment>): Comment => ({ id: '', postId: '', parentId: '', uid: '', name: '', text: '', createdAtMillis: 0, removedAtMillis: 0, ...c });
export const commentsCol = (db: Firestore, classId: string) => sub(db, classId, 'comments');

/**
 * Adds a comment (parentId '') or a reply, and raises the announcement's count in the same batch.
 * notifyUid is who should hear about it: the announcement's author, or the person replied to.
 */
export async function addComment(
  db: Firestore, actor: { uid: string; name: string }, classId: string, post: Announcement, parentId: string, text: string, notifyUid: string,
): Promise<void> {
  const body = text.trim().slice(0, 500);
  if (!body) throw new UserError('NAME_MISSING', 'Write a comment first.');
  const id = newId();
  const comment = newComment({ postId: post.id, parentId, uid: actor.uid, name: actor.name, text: body, createdAtMillis: nowMillis() });
  const batch = writeBatch(db);
  batch.set(doc(commentsCol(db, classId), id), withoutId(comment));
  batch.update(doc(announcementsCol(db, classId), post.id), { commentCount: increment(1), lastCommentId: id });
  await explainRefusal(db, classId, () => batch.commit());
  if (notifyUid && notifyUid !== actor.uid) {
    const title = parentId ? `${actor.name} replied to your comment` : `${actor.name} commented on "${post.title}"`;
    void queueNotice(db, actor.uid, classId, { kind: 'COMMENT', audience: 'USER', audienceId: notifyUid, title, body });
  }
}

/** Removes a comment's text (its writer, or ANNOUNCEMENTS_MANAGE). It keeps its place in the thread. */
export const removeComment = (db: Firestore, classId: string, commentId: string) =>
  updateDoc(doc(commentsCol(db, classId), commentId), { text: '', removedAtMillis: nowMillis() });

/** The comments of one announcement, oldest first. Loaded only while its thread is open. */
export function useComments(db: Firestore, classId: string, postId: string) {
  const live = useQueryList<Comment>(`v2/comments/${classId}/${postId}`, query(commentsCol(db, classId), where('postId', '==', postId)), (d) => fromDoc(newComment({}), d));
  return { ...live, data: live.data ? [...live.data].sort((a, b) => a.createdAtMillis - b.createdAtMillis) : live.data };
}

/** One member's votes: the id of an announcement or comment mapped to 1 (up) or -1 (down). */
export interface VoteMarks {
  id: string;
  marks: Record<string, number>;
}

/** Casts, changes or (value 0) takes back this member's vote on an announcement or comment. */
export function setVote(db: Firestore, classId: string, uid: string, targetId: string, value: 1 | -1 | 0): Promise<void> {
  return setDoc(doc(db, 'classes', classId, 'votes', uid), { marks: { [targetId]: value === 0 ? deleteField() : value } }, { merge: true });
}

export const useVotes = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<VoteMarks>(`v2/votes/${classId}/${enabled}`, enabled ? sub(db, classId, 'votes') : null, (d) => fromDoc<VoteMarks>({ id: '', marks: {} }, d));

/** Up and down counts for one target, counting current members only, and what this member chose. */
export function tally(votes: VoteMarks[], targetId: string, memberIds: Set<string>, myUid: string): { up: number; down: number; mine: number } {
  const result = { up: 0, down: 0, mine: 0 };
  for (const v of votes) {
    const mark = v.marks[targetId];
    if ((mark !== 1 && mark !== -1) || !memberIds.has(v.id)) continue;
    if (mark === 1) result.up++;
    else result.down++;
    if (v.id === myUid) result.mine = mark;
  }
  return result;
}

// ---------------------------------------------------------------- Timetable

export interface Meeting {
  id: string;
  courseId: string;
  /** 0 is Sunday, as in JavaScript dates. */
  dayOfWeek: number;
  /** Minutes after midnight, Philippine time. */
  startMinutes: number;
  endMinutes: number;
  room: string;
  note: string;
}

export const newMeeting = (m: Partial<Meeting>): Meeting => ({ id: '', courseId: '', dayOfWeek: 1, startMinutes: 480, endMinutes: 540, room: '', note: '', ...m });

export interface NoClassMark {
  id: string;
  /** YYYY-MM-DD in Philippine time. */
  dateKey: string;
  /** Empty: the whole day. */
  courseId: string;
  reason: string;
  createdByUid: string;
}

export const meetingsCol = (db: Firestore, classId: string) => sub(db, classId, 'meetings');
export const noClassCol = (db: Firestore, classId: string) => sub(db, classId, 'noClass');

/** Adds or changes a weekly meeting (SCHEDULE_MANAGE). */
export async function saveMeeting(db: Firestore, classId: string, meeting: Meeting): Promise<void> {
  if (!meeting.courseId) throw new UserError('NAME_MISSING', 'Choose the course of this meeting.');
  if (meeting.endMinutes <= meeting.startMinutes) throw new UserError('AMOUNT_INVALID', 'The meeting must end after it starts.');
  const clean = { ...meeting, room: meeting.room.trim().slice(0, 60), note: meeting.note.trim().slice(0, 200) };
  await explainRefusal(db, classId, () => setDoc(doc(meetingsCol(db, classId), meeting.id || newId()), withoutId(clean)));
}

export const deleteMeeting = (db: Firestore, classId: string, meetingId: string) => deleteDoc(doc(meetingsCol(db, classId), meetingId));

/** Marks one course, or the whole day when courseId is empty, as having no classes on a date. */
export async function addNoClass(db: Firestore, actorUid: string, classId: string, dateKey: string, courseId: string, reason: string): Promise<void> {
  const mark = { dateKey, courseId, reason: reason.trim().slice(0, 200), createdByUid: actorUid };
  await explainRefusal(db, classId, () => setDoc(doc(noClassCol(db, classId), newId()), mark));
  const day = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  void queueNotice(db, actorUid, classId, {
    kind: 'NO_CLASS', audience: courseId ? 'COURSE' : 'CLASS', audienceId: courseId, title: `No classes on ${day}`, body: mark.reason,
  });
}

export const removeNoClass = (db: Firestore, classId: string, markId: string) => deleteDoc(doc(noClassCol(db, classId), markId));

export const useMeetings = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<Meeting>(`v2/meetings/${classId}/${enabled}`, enabled ? meetingsCol(db, classId) : null, (d) => fromDoc(newMeeting({}), d));

export const useNoClass = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<NoClassMark>(`v2/noClass/${classId}/${enabled}`, enabled ? noClassCol(db, classId) : null, (d) =>
    fromDoc<NoClassMark>({ id: '', dateKey: '', courseId: '', reason: '', createdByUid: '' }, d),
  );

/** The Philippine date of a moment as YYYY-MM-DD, and its day of the week (0 is Sunday). */
export function manilaDay(millis: number): { dateKey: string; dayOfWeek: number } {
  const shifted = new Date(millis + 8 * 3600_000);
  return { dateKey: shifted.toISOString().slice(0, 10), dayOfWeek: shifted.getUTCDay() };
}

/** 510 -> "8:30 AM". */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A day's meetings in time order, each with the mark that cancels it (if any). */
export function meetingsOn(meetings: Meeting[], marks: NoClassMark[], millis: number): { meeting: Meeting; cancelled: NoClassMark | null }[] {
  const { dateKey, dayOfWeek } = manilaDay(millis);
  const today = marks.filter((k) => k.dateKey === dateKey);
  return meetings
    .filter((m) => m.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((meeting) => ({ meeting, cancelled: today.find((k) => !k.courseId || k.courseId === meeting.courseId) ?? null }));
}

// ---------------------------------------------------------------- Attendance

/** One sheet per class meeting on a date. Students not listed were present. */
export interface AttendanceSheet {
  id: string;
  dateKey: string;
  meetingId: string;
  courseId: string;
  absent: string[];
  late: string[];
  takenByUid: string;
  takenAtMillis: number;
}

export type AttendanceMark = 'PRESENT' | 'LATE' | 'ABSENT';

const newSheet = (a: Partial<AttendanceSheet>): AttendanceSheet => ({
  id: '', dateKey: '', meetingId: '', courseId: '', absent: [], late: [], takenByUid: '', takenAtMillis: 0, ...a,
});

export const attendanceCol = (db: Firestore, classId: string) => sub(db, classId, 'attendance');
export const sheetId = (dateKey: string, meetingId: string) => `${dateKey}_${meetingId}`;

/**
 * Saves the attendance of one meeting on one date (ATTENDANCE_MANAGE). Saving again replaces it.
 * isNew: no sheet existed for this meeting and date, so the course's count of meetings taken goes up by one.
 */
export async function saveAttendance(
  db: Firestore, actorUid: string, classId: string, dateKey: string, meeting: Meeting, marks: Record<string, AttendanceMark>, isNew = true,
): Promise<void> {
  const of = (mark: AttendanceMark) => Object.keys(marks).filter((uid) => marks[uid] === mark).sort();
  const sheet = { dateKey, meetingId: meeting.id, courseId: meeting.courseId, absent: of('ABSENT'), late: of('LATE'), takenByUid: actorUid, takenAtMillis: nowMillis() };
  const batch = writeBatch(db);
  batch.set(doc(attendanceCol(db, classId), sheetId(dateKey, meeting.id)), sheet);
  if (isNew) batch.set(doc(sub(db, classId, 'attendanceTotals'), meeting.courseId), { taken: increment(1) }, { merge: true });
  await explainRefusal(db, classId, () => batch.commit());
}

/** How many times attendance was taken for each course (course id to count). Every member may read it. */
export function useAttendanceTotals(db: Firestore, classId: string, enabled: boolean): Record<string, number> {
  const live = useQueryList<{ id: string; taken: number }>(`v2/attendanceTotals/${classId}/${enabled}`, enabled ? sub(db, classId, 'attendanceTotals') : null, (d) =>
    fromDoc<{ id: string; taken: number }>({ id: '', taken: 0 }, d),
  );
  return Object.fromEntries((live.data ?? []).map((t) => [t.id, t.taken]));
}

/** Every sheet, for officers who take attendance. */
export const useAttendance = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<AttendanceSheet>(`v2/attendance/${classId}/${enabled}`, enabled ? attendanceCol(db, classId) : null, (d) => fromDoc(newSheet({}), d));

/** A student's own absences and lates: the only sheets the rules let them read. */
export function useMyAttendance(db: Firestore, classId: string, uid: string, enabled: boolean) {
  const absent = useQueryList<AttendanceSheet>(
    `v2/myAbsent/${classId}/${uid}/${enabled}`,
    enabled ? query(attendanceCol(db, classId), where('absent', 'array-contains', uid)) : null,
    (d) => fromDoc(newSheet({}), d),
  );
  const late = useQueryList<AttendanceSheet>(
    `v2/myLate/${classId}/${uid}/${enabled}`,
    enabled ? query(attendanceCol(db, classId), where('late', 'array-contains', uid)) : null,
    (d) => fromDoc(newSheet({}), d),
  );
  return { absent: absent.data ?? [], late: late.data ?? [] };
}

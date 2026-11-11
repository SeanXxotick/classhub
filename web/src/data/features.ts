import { collection, deleteDoc, doc, query, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
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
  return recordId;
}

/** Rejects a waiting claim with a reason the student can read. */
export async function rejectClaim(db: Firestore, actorUid: string, classId: string, claimId: string, reason: string): Promise<void> {
  const why = reason.trim().slice(0, 200);
  if (!why) throw new UserError('NAME_MISSING', 'Write the reason.');
  await explainRefusal(db, classId, () =>
    updateDoc(doc(claimsCol(db, classId), claimId), { status: 'REJECTED', decidedByUid: actorUid, decidedAtMillis: nowMillis(), rejectReason: why }),
  );
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
}

export const newAnnouncement = (a: Partial<Announcement>): Announcement => ({
  id: '', title: '', body: '', pinned: false, createdByUid: '', createdAtMillis: 0, editedAtMillis: 0, ...a,
});

export const announcementsCol = (db: Firestore, classId: string) => sub(db, classId, 'announcements');

/** Posts a new announcement, or saves an edited one (ANNOUNCEMENTS_MANAGE). */
export async function saveAnnouncement(db: Firestore, actorUid: string, classId: string, post: Announcement): Promise<void> {
  const title = post.title.trim().slice(0, 120);
  if (!title) throw new UserError('NAME_MISSING', 'Give the announcement a title.');
  const body = post.body.trim().slice(0, 4000);
  if (!post.id) {
    const fresh = newAnnouncement({ title, body, pinned: post.pinned, createdByUid: actorUid, createdAtMillis: nowMillis() });
    await explainRefusal(db, classId, () => setDoc(doc(announcementsCol(db, classId), newId()), withoutId(fresh)));
  } else {
    await explainRefusal(db, classId, () => updateDoc(doc(announcementsCol(db, classId), post.id), { title, body, pinned: post.pinned, editedAtMillis: nowMillis() }));
  }
}

export const setPinned = (db: Firestore, classId: string, postId: string, pinned: boolean) =>
  updateDoc(doc(announcementsCol(db, classId), postId), { pinned });

export const deleteAnnouncement = (db: Firestore, classId: string, postId: string) => deleteDoc(doc(announcementsCol(db, classId), postId));

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

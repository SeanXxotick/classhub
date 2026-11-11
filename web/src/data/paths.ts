import {
  collection,
  doc,
  getDoc,
  increment,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import {
  newCharge,
  newClassRoom,
  newCourse,
  newInvite,
  newJoinRequest,
  newMember,
  newPendingOpeningBalance,
  newRecord,
  newRole,
  newStoredFundSummary,
  type Charge,
  type ClassRoom,
  type Course,
  type Invite,
  type JoinRequest,
  type LedgerRecord,
  type Member,
  type PendingOpeningBalance,
  type Role,
  type StoredFundSummary,
} from './models';
import type { FundSummary } from '../domain/ledger';
import { UserError } from './errors';
import { nowMillis } from './dataEnv';

/*
 * Document paths of the v2 data model (docs/PLAN-V2.md, "Data model (v2)") and the readers that turn a
 * snapshot into a model. Everything takes the Firestore instance, so the same code runs in the app and in
 * the emulator tests.
 */

export const classRef = (db: Firestore, classId: string) => doc(db, 'classes', classId);
export const inviteRef = (db: Firestore, code: string) => doc(db, 'invites', code);
export const classPhotoRef = (db: Firestore, classId: string) => doc(db, 'classPhotos', classId);
export const clientErrorsCol = (db: Firestore) => collection(db, 'clientErrors');

const sub = (db: Firestore, classId: string, name: string) => collection(db, 'classes', classId, name);

export const membersCol = (db: Firestore, classId: string) => sub(db, classId, 'members');
export const memberRef = (db: Firestore, classId: string, uid: string) => doc(membersCol(db, classId), uid);
export const rolesCol = (db: Firestore, classId: string) => sub(db, classId, 'roles');
export const roleRef = (db: Firestore, classId: string, roleId: string) => doc(rolesCol(db, classId), roleId);
export const joinRequestsCol = (db: Firestore, classId: string) => sub(db, classId, 'joinRequests');
export const joinRequestRef = (db: Firestore, classId: string, uid: string) => doc(joinRequestsCol(db, classId), uid);
export const coursesCol = (db: Firestore, classId: string) => sub(db, classId, 'courses');
export const recordsCol = (db: Firestore, classId: string) => sub(db, classId, 'records');
export const recordRef = (db: Firestore, classId: string, id: string) => doc(recordsCol(db, classId), id);
export const chargesCol = (db: Firestore, classId: string) => sub(db, classId, 'charges');
export const chargeRef = (db: Firestore, classId: string, batchId: string) => doc(chargesCol(db, classId), batchId);
export const summaryRef = (db: Firestore, classId: string) => doc(db, 'classes', classId, 'summary', 'fund');
export const openingBalancesCol = (db: Firestore, classId: string) => sub(db, classId, 'openingBalances');
export const openingBalanceRef = (db: Firestore, classId: string, uid: string) => doc(openingBalancesCol(db, classId), uid);

/**
 * Every sub-collection a class can have that holds documents today, in the order the class delete removes
 * them. claims, announcements, seen, meetings, noClass and outbox are not open yet (no rules), so they hold nothing.
 */
export const CLASS_SUBCOLLECTIONS = [
  'records', 'charges', 'summary', 'openingBalances', 'joinRequests', 'claims', 'announcements', 'seen', 'meetings', 'noClass', 'attendance', 'attendanceTotals', 'schedule', 'contents', 'courses', 'progress', 'members', 'roles',
] as const;
export const classSubCol = (db: Firestore, classId: string, name: (typeof CLASS_SUBCOLLECTIONS)[number]): CollectionReference<DocumentData> =>
  sub(db, classId, name);

/** The class id of a document directly inside classes/{classId}/{collection}. */
export function classIdOf(ref: DocumentReference<DocumentData>): string {
  return ref.parent.parent?.id ?? '';
}

// ---- Reading documents as models

/** The model's defaults, then the stored fields, then the document id in idField. A stored 'id' field is ignored. */
export function modelFrom<T extends object>(defaults: T, snap: DocumentSnapshot<DocumentData>, idField: keyof T | null): T {
  const data = { ...defaults, ...(snap.data() ?? {}) } as T;
  if (idField) (data as Record<string, unknown>)[idField as string] = snap.id;
  return data;
}

export const toClassRoom = (s: DocumentSnapshot<DocumentData>): ClassRoom => modelFrom(newClassRoom({}), s, 'id');
export const toInvite = (s: DocumentSnapshot<DocumentData>): Invite => modelFrom(newInvite({}), s, 'code');
export const toMember = (s: DocumentSnapshot<DocumentData>): Member => modelFrom(newMember({}), s, 'id');
export const toRole = (s: DocumentSnapshot<DocumentData>): Role => modelFrom(newRole({}), s, 'id');
export const toJoinRequest = (s: DocumentSnapshot<DocumentData>): JoinRequest => modelFrom(newJoinRequest({}), s, 'id');
export const toCourse = (s: DocumentSnapshot<DocumentData>): Course => modelFrom(newCourse({}), s, 'id');
export const toRecord = (s: DocumentSnapshot<DocumentData>): LedgerRecord => modelFrom(newRecord({}), s, 'id');
export const toCharge = (s: DocumentSnapshot<DocumentData>): Charge => modelFrom(newCharge({}), s, 'id');
export const toFundSummary = (s: DocumentSnapshot<DocumentData>): StoredFundSummary => modelFrom(newStoredFundSummary({}), s, null);
export const toPendingOpeningBalance = (s: DocumentSnapshot<DocumentData>): PendingOpeningBalance =>
  modelFrom(newPendingOpeningBalance({}), s, 'id');

/** A model without its id field, ready to store (the id lives in the path; the rules accept no other value). */
export function withoutId<T extends { id: string }>(model: T): Omit<T, 'id'> {
  const copy: Partial<T> = { ...model };
  delete copy.id;
  return copy as Omit<T, 'id'>;
}

// ---- Errors

/** The Firestore error code, or '' for anything else. Compared by code, so two copies of the SDK cannot confuse it. */
export function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

export const isDenied = (error: unknown): boolean => errorCode(error) === 'permission-denied';

/**
 * Runs a write in a class. When the rules refuse it because the class is being deleted, the refusal is
 * explained as CLASS_DELETING instead of the plain "no permission".
 */
export async function explainRefusal<T>(db: Firestore, classId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (isDenied(e)) {
      const room = await getDoc(classRef(db, classId)).catch(() => null);
      if (room?.exists() && (room.get('deletingAtMillis') ?? 0) > 0) throw new UserError('CLASS_DELETING');
      throw new UserError('NO_PERMISSION');
    }
    throw e;
  }
}

/** Reads the class (from the cache when offline) and refuses when it is gone or being deleted. */
export async function readOpenClass(db: Firestore, classId: string): Promise<ClassRoom> {
  const snap = await getDoc(classRef(db, classId)).catch((e) => {
    if (isDenied(e)) throw new UserError('NOT_A_MEMBER');
    throw e;
  });
  if (!snap.exists()) throw new UserError('CLASS_GONE');
  const room = toClassRoom(snap);
  if (room.deletingAtMillis > 0) throw new UserError('CLASS_DELETING');
  return room;
}

/** The signed-in user's role in the class, or null when they are not in it. Uses the cache when offline. */
export async function readMyRole(db: Firestore, classId: string, uid: string): Promise<Role | null> {
  const member = await getDoc(memberRef(db, classId, uid));
  if (!member.exists()) return null;
  const role = await getDoc(roleRef(db, classId, String(member.get('roleId') ?? ''))).catch((e) => {
    if (isDenied(e)) return null;
    throw e;
  });
  return role?.exists() ? toRole(role) : null;
}

// ---- The fund summary

/** -0 would be stored as a double and the rules want whole numbers, so every zero is a plain 0. */
const int = (n: number) => (n === 0 ? 0 : n);

/** Adds a set of summary changes up (for several records written in one batch). */
export function addSummaryDeltas(deltas: FundSummary[]): FundSummary {
  const total: FundSummary = { cashOnHandCentavos: 0, waitingPayoutCentavos: 0, balancesTotalCentavos: 0, recordCount: 0 };
  for (const d of deltas) {
    total.cashOnHandCentavos += d.cashOnHandCentavos;
    total.waitingPayoutCentavos += d.waitingPayoutCentavos;
    total.balancesTotalCentavos += d.balancesTotalCentavos;
    total.recordCount += d.recordCount;
  }
  return total;
}

/**
 * The summary change that goes in the same batch as every record write. Increments, so two treasurers
 * writing at once do not overwrite each other, and it also queues while offline. The first record of a
 * class creates the summary if it is missing.
 */
export function bumpSummary(batch: WriteBatch, db: Firestore, classId: string, delta: FundSummary): void {
  batch.set(
    summaryRef(db, classId),
    {
      cashOnHandCentavos: increment(int(delta.cashOnHandCentavos)),
      waitingPayoutCentavos: increment(int(delta.waitingPayoutCentavos)),
      balancesTotalCentavos: increment(int(delta.balancesTotalCentavos)),
      recordCount: increment(int(delta.recordCount)),
      updatedAtMillis: nowMillis(),
    },
    { merge: true },
  );
}

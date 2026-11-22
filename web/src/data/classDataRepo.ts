import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { ContentItem, LedgerRecord, ScheduleItem, ScheduleStatus } from './models';
import { commitLogged, type LogNote } from './history';

/* The ledger, schedule, done marks and class contents, written exactly as the Android app writes them. */

export const recordsOf = (classId: string) => collection(db, 'classes', classId, 'records');
export const scheduleOf = (classId: string) => collection(db, 'classes', classId, 'schedule');
export const progressOf = (classId: string) => collection(db, 'classes', classId, 'progress');
export const contentsOf = (classId: string) => collection(db, 'classes', classId, 'contents');

const MAX_BATCH = 500;

// ---- Ledger ----

export async function addRecord(classId: string, record: LedgerRecord): Promise<void> {
  await addDoc(recordsOf(classId), { ...record, id: '' });
}

/** Saves all records together or none of them. A Firestore batch holds up to 500 writes. */
export async function addRecords(classId: string, records: LedgerRecord[]): Promise<void> {
  if (records.length > MAX_BATCH) throw new Error('Too many records for one batch');
  const batch = writeBatch(db);
  for (const r of records) batch.set(doc(recordsOf(classId)), { ...r, id: '' });
  await batch.commit();
}

export function deleteRecord(classId: string, recordId: string): Promise<void> {
  return deleteDoc(doc(recordsOf(classId), recordId));
}

/** Undoes a whole charge: removes every record that shares the batch id. */
export async function deleteChargeBatch(classId: string, batchId: string): Promise<void> {
  if (!batchId) throw new Error('batchId must not be empty');
  const docs = await getDocs(query(recordsOf(classId), where('batchId', '==', batchId)));
  const batch = writeBatch(db);
  docs.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ---- Schedule ----

export async function addScheduleItem(classId: string, item: ScheduleItem): Promise<void> {
  await addDoc(scheduleOf(classId), { ...item, id: '', createdAtMillis: Date.now() });
}

export function updateScheduleItem(classId: string, item: ScheduleItem, log?: LogNote): Promise<void> {
  return commitLogged(db, classId, log, (b) => b.set(doc(scheduleOf(classId), item.id), item));
}

export function setScheduleStatus(classId: string, itemId: string, status: ScheduleStatus, log?: LogNote): Promise<void> {
  return commitLogged(db, classId, log, (b) => b.update(doc(scheduleOf(classId), itemId), { status }));
}

export function deleteScheduleItem(classId: string, itemId: string, log?: LogNote): Promise<void> {
  return commitLogged(db, classId, log, (b) => b.delete(doc(scheduleOf(classId), itemId)));
}

// ---- Each student's own done marks ----

export function markDone(classId: string, uid: string, itemId: string): Promise<void> {
  return setDoc(doc(progressOf(classId), uid), { done: { [itemId]: Date.now() } }, { merge: true });
}

export function markNotDone(classId: string, uid: string, itemId: string): Promise<void> {
  return setDoc(doc(progressOf(classId), uid), { done: { [itemId]: deleteField() } }, { merge: true });
}

// ---- Class contents ----

export async function addContent(classId: string, item: ContentItem): Promise<void> {
  await addDoc(contentsOf(classId), { ...item, id: '' });
}

export function updateContent(classId: string, item: ContentItem, log?: LogNote): Promise<void> {
  return commitLogged(db, classId, log, (b) => b.set(doc(contentsOf(classId), item.id), item));
}

export function deleteContent(classId: string, itemId: string, log?: LogNote): Promise<void> {
  return commitLogged(db, classId, log, (b) => b.delete(doc(contentsOf(classId), itemId)));
}

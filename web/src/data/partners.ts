/*
 * Partner classes (classes/{classId}/partners/{partnerId}):
 * Classes that have linked a shared grouping together become partner classes, allowing officers
 * to include a partner class directly when posting a poll. Either class can unlink anytime.
 */
import { collection, deleteDoc, doc, setDoc, type Firestore } from 'firebase/firestore';
import { nowMillis } from './dataEnv';
import { fromDoc, useQueryList } from './live';

export interface PartnerClass {
  id: string;
  partnerClassId: string;
  name: string;
  tag: string;
  accentColor: string;
  linkedAtMillis: number;
}

export const newPartnerClass = (p: Partial<PartnerClass>): PartnerClass => ({
  id: '',
  partnerClassId: '',
  name: '',
  tag: '',
  accentColor: '',
  linkedAtMillis: 0,
  ...p,
});

export const partnersCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'partners');
export const partnerRef = (db: Firestore, classId: string, partnerClassId: string) =>
  doc(partnersCol(db, classId), partnerClassId);

/** Saves or refreshes a partner class record under `classes/{classId}/partners/{partnerClassId}`. */
export async function savePartnerClass(
  db: Firestore,
  classId: string,
  partner: { partnerClassId: string; name: string; tag: string; accentColor?: string },
): Promise<void> {
  if (!partner.partnerClassId || partner.partnerClassId === classId) return;
  await setDoc(partnerRef(db, classId, partner.partnerClassId), {
    partnerClassId: partner.partnerClassId,
    name: partner.name.trim().slice(0, 100) || 'Partner class',
    tag: partner.tag.trim().slice(0, 24) || 'Partner',
    accentColor: (partner.accentColor ?? '').trim().slice(0, 9),
    linkedAtMillis: nowMillis(),
  });
}

/** Removes a partner class so it can no longer receive direct shared polls from this class. */
export async function removePartnerClass(db: Firestore, classId: string, partnerClassId: string): Promise<void> {
  await deleteDoc(partnerRef(db, classId, partnerClassId));
}

/** Live list of partner classes for `classId`. */
export function usePartnerClasses(db: Firestore, classId: string, enabled: boolean) {
  const live = useQueryList<PartnerClass>(
    `v2/partners/${classId}/${enabled}`,
    enabled ? partnersCol(db, classId) : null,
    (d) => fromDoc(newPartnerClass({}), d),
  );
  return {
    ...live,
    data: live.data ? [...live.data].sort((a, b) => a.name.localeCompare(b.name)) : live.data,
  };
}

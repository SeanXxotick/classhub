import { doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { SEEN_TABS, type SeenTab, type TabsSeen } from '../domain/tabCounts';
import { nowMillis } from './dataEnv';

/*
 * When this user last opened each class tab, for the red unseen counts: users/{uid}.tabsSeen.{classId}.{tab}.
 * It is on the account (only its owner reads or writes the users document), so opening News on the phone
 * also clears its count on the computer.
 */

/** The times for one class: undefined while loading, null before the first visit since unseen counts began. */
export function useTabsSeen(db: Firestore, uid: string, classId: string): TabsSeen | null | undefined {
  const [seen, setSeen] = useState<{ key: string; value: TabsSeen | null } | null>(null);
  const key = `${uid}/${classId}`;
  useEffect(() => {
    if (!uid || !classId) return;
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const forClass = (snap.get('tabsSeen') as Record<string, Record<string, unknown>> | undefined)?.[classId];
        if (!forClass || typeof forClass !== 'object') return setSeen({ key, value: null });
        const value = Object.fromEntries(SEEN_TABS.map((t) => [t, Number(forClass[t] ?? 0) || 0])) as TabsSeen;
        setSeen({ key, value });
      },
      // Without the times, nothing counts as new.
      () => setSeen({ key, value: null }),
    );
  }, [db, uid, classId, key]);
  return seen?.key === key ? seen.value : undefined;
}

/** Records that these tabs were opened now. */
export function markTabsSeen(db: Firestore, uid: string, classId: string, tabs: readonly SeenTab[]): Promise<void> {
  const now = nowMillis();
  return setDoc(doc(db, 'users', uid), { tabsSeen: { [classId]: Object.fromEntries(tabs.map((t) => [t, now])) } }, { merge: true });
}

import { useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { auth, db } from './firebase';
import type { AppUser } from './models';
import { NameRules, type PersonName } from '../domain/nameRules';

const userDoc = (uid: string) => doc(db, 'users', uid);
const membershipsOf = (uid: string) => collection(db, 'users', uid, 'memberships');
const classDoc = (classId: string) => doc(db, 'classes', classId);

export type Session = { state: 'loading' } | { state: 'signedOut' } | { state: 'signedIn'; user: AppUser };

/**
 * The signed-in user, or signed out. The profile document is watched live, so a name saved just
 * after sign-up still shows up.
 */
export function useSession(): Session {
  const [firebaseUser, setFirebaseUser] = useState<User | null | undefined>(undefined);
  const [session, setSession] = useState<Session>({ state: 'loading' });

  useEffect(() => onAuthStateChanged(auth, setFirebaseUser), []);

  useEffect(() => {
    if (firebaseUser === undefined) return;
    if (firebaseUser === null) {
      setSession({ state: 'signedOut' });
      return;
    }
    const email = firebaseUser.email ?? '';
    const fallbackName = email.split('@')[0];
    const build = (data: Record<string, unknown> | undefined): AppUser => ({
      uid: firebaseUser.uid,
      email,
      displayName: (typeof data?.displayName === 'string' && data.displayName.trim()) || fallbackName,
      firstName: (data?.firstName as string) ?? '',
      middleInitial: (data?.middleInitial as string) ?? '',
      lastName: (data?.lastName as string) ?? '',
      mustChangePassword: data?.mustChangePassword === true,
    });
    return onSnapshot(
      userDoc(firebaseUser.uid),
      (snap) => setSession({ state: 'signedIn', user: build(snap.data()) }),
      () => setSession({ state: 'signedIn', user: build(undefined) }),
    );
  }, [firebaseUser]);

  return session;
}

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signUp(name: PersonName, email: string, password: string): Promise<void> {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const parts = NameRules.cleaned(name);
  await setDoc(userDoc(result.user.uid), {
    displayName: NameRules.display(parts),
    firstName: parts.first,
    middleInitial: parts.middleInitial,
    lastName: parts.last,
    email: email.trim(),
  });
}

function currentUser(): User {
  const user = auth.currentUser;
  if (!user) throw new Error('You are signed out. Sign in again first.');
  return user;
}

/** Sets a new password for the signed-in user and clears the "must change password" flag. */
export async function changePassword(newPassword: string): Promise<void> {
  const user = currentUser();
  await updatePassword(user, newPassword);
  await setDoc(userDoc(user.uid), { mustChangePassword: false }, { merge: true });
}

/** Emails a password reset link. An unknown email is treated as sent, so the app never reveals which emails have accounts. */
export async function sendPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    if (e instanceof FirebaseError && e.code === 'auth/user-not-found') return;
    throw e;
  }
}

/** Saves a new name on the profile and on the member entry of every class the user is in, in one batch. */
export async function updateName(name: PersonName): Promise<void> {
  const uid = currentUser().uid;
  const parts = NameRules.cleaned(name);
  const display = NameRules.display(parts);
  const memberships = await getDocs(membershipsOf(uid));
  const batch = writeBatch(db);
  batch.set(userDoc(uid), { displayName: display, firstName: parts.first, middleInitial: parts.middleInitial, lastName: parts.last }, { merge: true });
  // Only entries that still exist and show a different name: classes the user was removed from are skipped.
  for (const m of memberships.docs) {
    const entry = doc(db, 'classes', m.id, 'members', uid);
    const current = await getDoc(entry).catch(() => null);
    if (current?.exists() && current.get('name') !== display) batch.update(entry, { name: display });
  }
  await batch.commit();
}

/** Names of the classes where the signed-in user is the Mayor. They must hand those over before deleting their account. */
export async function classesIOwn(): Promise<string[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const names: string[] = [];
  for (const m of (await getDocs(membershipsOf(uid))).docs) {
    // A class the user was removed from can no longer be read; they do not own it.
    const room = await getDoc(classDoc(m.id)).catch(() => null);
    if (room?.get('ownerUid') === uid) names.push(room.get('name') ?? m.get('className'));
  }
  return names;
}

/**
 * Deletes the signed-in account for good: confirms the password, leaves every class (member entry,
 * membership and done marks), removes the profile and photo, then deletes the sign-in.
 * Ledger records about the student stay, because they are part of the class fund's history.
 */
export async function deleteAccount(password: string): Promise<void> {
  const user = currentUser();
  if (!user.email) throw new Error('This account has no email, so it cannot be confirmed.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  const uid = user.uid;
  if ((await classesIOwn()).length > 0) throw new Error('You are still the Mayor of a class. Make someone else the Mayor first.');

  const batch = writeBatch(db);
  for (const m of (await getDocs(membershipsOf(uid))).docs) {
    const member = doc(db, 'classes', m.id, 'members', uid);
    // Skip classes the user was already removed from; deleting there would be refused.
    const exists = await getDoc(member).then((s) => s.exists()).catch(() => false);
    if (exists) {
      batch.delete(member);
      batch.delete(doc(db, 'classes', m.id, 'progress', uid));
    }
    batch.delete(m.ref);
  }
  batch.delete(doc(db, 'avatars', uid));
  batch.delete(userDoc(uid));
  await batch.commit();
  await deleteUser(user);
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth);
}

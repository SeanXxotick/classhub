import { useEffect, useState } from 'react';
import { type Firestore } from 'firebase/firestore';
import { useDocValue, useQueryList, type Live } from './live';
import type { Charge, ClassRoom, Course, JoinRequest, Member, PendingOpeningBalance, Role, StoredFundSummary } from './models';
import { watchMyClasses, type MyClasses } from './membership';
import { watchVisibleRecords, type VisibleRecords } from './ledgerWatch';
import { repairFundSummary } from './ledgerStore';
import { applyPendingOpeningBalances } from './openingBalances';
import {
  chargesCol,
  classRef,
  coursesCol,
  joinRequestsCol,
  memberRef,
  membersCol,
  openingBalancesCol,
  rolesCol,
  summaryRef,
  toCharge,
  toClassRoom,
  toCourse,
  toFundSummary,
  toJoinRequest,
  toMember,
  toPendingOpeningBalance,
  toRole,
} from './paths';

/*
 * React hooks over the v2 data layer. Thin: the plain functions in membership.ts, ledgerWatch.ts and the
 * others do the work (and are tested on the emulator); these only keep them live in a screen.
 * Pass the app's db from firebase.ts.
 */

/** "My classes": approved classes (with their class documents) and waiting requests. */
export function useMyClasses(db: Firestore, uid: string | null): Live<MyClasses> {
  const [state, setState] = useState<Live<MyClasses> & { uid: string | null }>({ uid, data: undefined, error: null });
  useEffect(() => {
    if (!uid) return;
    return watchMyClasses(db, uid, (data) => setState({ uid, data, error: null }), (error) => setState({ uid, data: undefined, error: error as Live<MyClasses>['error'] }));
  }, [db, uid]);
  return state.uid === uid ? state : { data: undefined, error: null };
}

export const useClassRoom = (db: Firestore, classId: string) =>
  useDocValue<ClassRoom>(`v2/class/${classId}`, classRef(db, classId), toClassRoom);

/** The user's own member entry: null when they are not (or no longer) in the class. Always readable. */
export const useMyMember = (db: Firestore, classId: string, uid: string) =>
  useDocValue<Member>(`v2/me/${classId}/${uid}`, memberRef(db, classId, uid), toMember);

/** Members and roles: pass enabled = false until the user is known to be a member. */
export const useMembers = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<Member>(`v2/members/${classId}/${enabled}`, enabled ? membersCol(db, classId) : null, toMember);

export const useRoles = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<Role>(`v2/roles/${classId}/${enabled}`, enabled ? rolesCol(db, classId) : null, toRole);

export const useCourses = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<Course>(`v2/courses/${classId}/${enabled}`, enabled ? coursesCol(db, classId) : null, toCourse);

/** Waiting join requests: only for MEMBERS_MANAGE (pass canManageMembers). */
export const useJoinRequests = (db: Firestore, classId: string, canManageMembers: boolean) =>
  useQueryList<JoinRequest>(`v2/requests/${classId}/${canManageMembers}`, canManageMembers ? joinRequestsCol(db, classId) : null, toJoinRequest);

/** Charge documents (no names): every member may read them. */
export const useCharges = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<Charge>(`v2/charges/${classId}/${enabled}`, enabled ? chargesCol(db, classId) : null, toCharge);

/** The fund totals every member reads. null until the first record (or the create batch) writes it. */
export const useFundSummary = (db: Firestore, classId: string, enabled: boolean) =>
  useDocValue<StoredFundSummary>(`v2/summary/${classId}/${enabled}`, enabled ? summaryRef(db, classId) : null, toFundSummary);

/** Pending opening balances: only for RECORDS_MANAGE. */
export const usePendingOpeningBalances = (db: Firestore, classId: string, canManageRecords: boolean) =>
  useQueryList<PendingOpeningBalance>(
    `v2/opening/${classId}/${canManageRecords}`, canManageRecords ? openingBalancesCol(db, classId) : null, toPendingOpeningBalance,
  );

/** The records this user may read, switching queries by itself with the role and the visibility setting. */
export function useVisibleRecords(db: Firestore, classId: string, uid: string): Live<VisibleRecords> {
  const key = `${classId}/${uid}`;
  const [state, setState] = useState<Live<VisibleRecords> & { key: string }>({ key, data: undefined, error: null });
  useEffect(() => {
    return watchVisibleRecords(
      db, classId, uid,
      (data) => setState({ key, data, error: null }),
      (error) => setState((s) => ({ ...s, key, error: error as Live<VisibleRecords>['error'] })),
    );
  }, [db, classId, uid, key]);
  return state.key === key ? state : { data: undefined, error: null };
}

/**
 * Run on the Ledger screen of a records manager: applies pending opening balances of students who are now
 * members, then repairs the fund summary if it is off. Once per class and user; failures stay quiet
 * (the next opening tries again).
 */
export function useLedgerUpkeep(db: Firestore, classId: string, uid: string, canManageRecords: boolean): void {
  useEffect(() => {
    if (!canManageRecords) return;
    let cancelled = false;
    (async () => {
      try {
        await applyPendingOpeningBalances(db, uid, classId);
        if (!cancelled) await repairFundSummary(db, uid, classId);
      } catch {
        // Offline or refused: nothing to show; it runs again next time.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, classId, uid, canManageRecords]);
}

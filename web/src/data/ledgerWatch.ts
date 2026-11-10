import { onSnapshot, query, where, type Firestore, type Unsubscribe } from 'firebase/firestore';
import type { ClassRoom, LedgerRecord, Member, Role } from './models';
import { canSeeAllBalances } from '../domain/permissions';
import { classRef, isDenied, memberRef, recordsCol, roleRef, toClassRoom, toMember, toRecord, toRole } from './paths';

/*
 * The ledger records a person may read (docs/PLAN-V2.md, "Balance visibility"). Security rules cannot filter
 * a list, so the queries depend on the person: someone who sees every balance listens to all records; anyone
 * else listens to exactly the two queries the rules allow (their own records, and every EXPENSE) and gets
 * them merged. The choice is made here, from the live class, member entry and role, so a screen cannot pick
 * the wrong query, and it switches by itself when the role or the class's setting changes.
 */

export type RecordScope = 'ALL' | 'OWN' | 'NONE';

export interface VisibleRecords {
  /** Newest first (by date, then by when saved). */
  records: LedgerRecord[];
  /** ALL: every record. OWN: own records and pay-outs. NONE: not in the class. */
  scope: RecordScope;
}

/** Which records this role may read under the class's setting (canSeeAllBalances in the domain). */
export function recordScope(role: Role | null | undefined, room: ClassRoom | null | undefined): RecordScope {
  if (!role || !room) return 'NONE';
  return canSeeAllBalances(role, room.balanceVisibility) ? 'ALL' : 'OWN';
}

const newestFirst = (list: LedgerRecord[]) =>
  [...list].sort((a, b) => b.dateMillis - a.dateMillis || b.createdAtMillis - a.createdAtMillis || (a.id < b.id ? -1 : 1));

export interface WatchOptions {
  /** Called with each records query opened ('ALL', 'OWN' or 'EXPENSE'); for tests. */
  onListen?: (what: 'ALL' | 'OWN' | 'EXPENSE') => void;
}

/**
 * Keeps the records this user may read live. onChange gets the list and its scope; onError only gets
 * errors other than a refusal (a refusal while the role or setting is changing falls back to the own
 * records, and a refusal of those means the user is no longer in the class: scope NONE).
 */
export function watchVisibleRecords(
  db: Firestore,
  classId: string,
  uid: string,
  onChange: (value: VisibleRecords) => void,
  onError: (e: Error) => void = () => undefined,
  options: WatchOptions = {},
): Unsubscribe {
  let member: Member | null | undefined;
  let room: ClassRoom | null | undefined;
  let role: Role | null | undefined;
  let roleUnsub: Unsubscribe | null = null;
  let roleId = '';
  let current: RecordScope | 'WAIT' = 'WAIT';
  let recordUnsubs: Unsubscribe[] = [];
  /** The role and setting for which the ALL query was refused: stay on OWN until either changes. */
  let refusedFor = '';
  let stopped = false;

  const fail = (e: Error) => {
    if (isDenied(e)) return;
    onError(e);
  };

  const stopRecords = () => {
    recordUnsubs.forEach((u) => u());
    recordUnsubs = [];
  };

  const key = () => `${roleId}|${room?.balanceVisibility ?? ''}|${role?.permissions.join(',') ?? ''}|${role?.locked ?? ''}`;

  const decide = () => {
    if (stopped) return;
    let wanted: RecordScope | 'WAIT';
    if (member === null || room === null || role === null) wanted = 'NONE';
    else if (member === undefined || room === undefined || role === undefined) wanted = 'WAIT';
    else wanted = recordScope(role, room);
    if (wanted === 'ALL' && refusedFor === key()) wanted = 'OWN';
    if (wanted === current) return;
    current = wanted;
    stopRecords();
    if (wanted === 'WAIT') return;
    if (wanted === 'NONE') {
      onChange({ records: [], scope: 'NONE' });
      return;
    }
    if (wanted === 'ALL') {
      options.onListen?.('ALL');
      recordUnsubs.push(onSnapshot(
        recordsCol(db, classId),
        (snap) => onChange({ records: newestFirst(snap.docs.map(toRecord)), scope: 'ALL' }),
        (e) => {
          if (!isDenied(e)) return onError(e);
          // The server already applies the new role or setting; the snapshots here will catch up.
          refusedFor = key();
          current = 'WAIT';
          decide();
        },
      ));
      return;
    }
    let own: LedgerRecord[] | undefined;
    let payouts: LedgerRecord[] | undefined;
    const emit = () => {
      if (!own || !payouts) return;
      const byId = new Map<string, LedgerRecord>();
      for (const r of [...own, ...payouts]) byId.set(r.id, r);
      onChange({ records: newestFirst([...byId.values()]), scope: 'OWN' });
    };
    const refused = (e: Error) => {
      if (!isDenied(e)) return onError(e);
      stopRecords();
      current = 'NONE';
      onChange({ records: [], scope: 'NONE' });
    };
    options.onListen?.('OWN');
    recordUnsubs.push(onSnapshot(query(recordsCol(db, classId), where('memberId', '==', uid)), (s) => { own = s.docs.map(toRecord); emit(); }, refused));
    options.onListen?.('EXPENSE');
    recordUnsubs.push(onSnapshot(query(recordsCol(db, classId), where('type', '==', 'EXPENSE')), (s) => { payouts = s.docs.map(toRecord); emit(); }, refused));
  };

  const watchRole = (id: string) => {
    if (id === roleId && roleUnsub) return;
    roleUnsub?.();
    roleId = id;
    role = undefined;
    roleUnsub = onSnapshot(
      roleRef(db, classId, id),
      (s) => { role = s.exists() ? toRole(s) : null; decide(); },
      (e) => { role = null; fail(e); decide(); },
    );
  };

  const memberUnsub = onSnapshot(
    memberRef(db, classId, uid),
    (s) => {
      member = s.exists() ? toMember(s) : null;
      if (member) watchRole(member.roleId);
      else { roleUnsub?.(); roleUnsub = null; roleId = ''; role = null; }
      decide();
    },
    (e) => { member = null; fail(e); decide(); },
  );

  const classUnsub = onSnapshot(
    classRef(db, classId),
    (s) => { room = s.exists() ? toClassRoom(s) : null; decide(); },
    (e) => { room = null; fail(e); decide(); },
  );

  return () => {
    stopped = true;
    memberUnsub();
    classUnsub();
    roleUnsub?.();
    stopRecords();
  };
}

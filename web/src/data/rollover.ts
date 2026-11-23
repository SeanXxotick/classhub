/*
 * Semester rollover ("Start a new semester"): creates a fresh class for the next term carrying over
 * the current class's roles, members, optional closing balances (as OPENING records), and optional
 * payment settings. The old class stays intact as an archive.
 */
import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { ClassRules } from '../domain/classRules';
import { Ledger } from '../domain/ledger';
import { DefaultRoles } from '../domain/permissions';
import { newId, newInviteCode, nowMillis } from './dataEnv';
import { UserError } from './errors';
import { buildRecord } from './ledgerStore';
import { ROLE_MAYOR, ROLE_MEMBER, newClassRoom, newMember, type ClassRoom, type Member, type Role } from './models';
import { classRef, inviteRef, memberRef, recordRef, roleRef, summaryRef, withoutId } from './paths';

const MAX_CODE_TRIES = 5;
const BATCH_LIMIT = 400;

async function unusedInviteCode(db: Firestore): Promise<string> {
  for (let i = 0; i < MAX_CODE_TRIES; i++) {
    const code = newInviteCode();
    if (!(await getDoc(inviteRef(db, code))).exists()) return code;
  }
  throw new UserError('INVITE_CODE_UNAVAILABLE');
}

export interface RolloverSource {
  room: ClassRoom;
  roles: Role[];
  members: Member[];
  balances: Map<string, number>;
}

export interface RolloverInput {
  name: string;
  description: string;
  carryBalances: boolean;
  carryPaymentSettings: boolean;
}

export interface RolloverResult {
  classId: string;
  inviteCode: string;
  copiedMembers: number;
  copiedBalances: number;
}

/**
 * Mayor-only: creates a new semester class with the same roles and members, optionally carrying over
 * every current member's non-zero balance as an OPENING record.
 */
export async function rolloverClass(db: Firestore, ownerUid: string, source: RolloverSource, input: RolloverInput): Promise<RolloverResult> {
  if (source.room.ownerUid !== ownerUid) throw new UserError('NO_PERMISSION', 'Only the Mayor can start a new semester.');
  const nameProblem = ClassRules.checkName(input.name);
  if (nameProblem) throw new UserError('CLASS_NAME_MISSING', nameProblem);

  const me = source.members.find((m) => m.id === ownerUid);
  const ownerName = (me?.name ?? '').trim();
  if (!ownerName) throw new UserError('NAME_MISSING');

  const code = await unusedInviteCode(db);
  const classId = newId();
  const now = nowMillis();
  const roles = source.roles.length > 0 ? source.roles : DefaultRoles.all();
  const validRoleIds = new Set(roles.filter((r) => !r.locked).map((r) => r.id));
  const defaultRoleId = validRoleIds.has(source.room.defaultRoleId) ? source.room.defaultRoleId : ROLE_MEMBER;

  const newRoom = newClassRoom({
    id: classId,
    name: input.name.trim(),
    description: input.description.trim().slice(0, ClassRules.MAX_DESCRIPTION),
    ownerUid,
    accentColor: source.room.accentColor,
    inviteCode: code,
    defaultRoleId,
    ledgerEnabled: source.room.ledgerEnabled,
    scheduleEnabled: source.room.scheduleEnabled,
    contentsEnabled: source.room.contentsEnabled,
    announcementsEnabled: source.room.announcementsEnabled,
    timetableEnabled: source.room.timetableEnabled,
    scheduleIcons: source.room.scheduleIcons,
    scheduleColors: source.room.scheduleColors,
    contentIcons: source.room.contentIcons,
    contentColors: source.room.contentColors,
    balanceVisibility: input.carryPaymentSettings ? source.room.balanceVisibility : 'EVERYONE',
    paymentInfo: input.carryPaymentSettings ? source.room.paymentInfo : '',
    deletingAtMillis: 0,
    createdAtMillis: now,
  });

  // 1. Create the class, all roles, the Mayor's own entry, and the invite code in one batch.
  const first = writeBatch(db);
  first.set(classRef(db, classId), withoutId(newRoom));
  for (const role of roles) first.set(roleRef(db, classId, role.id), withoutId(role));
  first.set(
    memberRef(db, classId, ownerUid),
    withoutId(newMember({ uid: ownerUid, name: ownerName, roleId: ROLE_MAYOR, joinedAtMillis: now })),
  );
  first.set(inviteRef(db, code), { classId, className: newRoom.name });
  // Where this class came from: the rules let the Mayor copy only that class's members.
  first.set(doc(db, 'classes', classId, 'rollover', 'source'), { fromClassId: source.room.id });
  await first.commit();

  // Irregular students are cross-enrolled for specific courses only and do not carry over with the block.
  const carriedMembers = source.members.filter((m) => m.id === ownerUid || !m.irregular);
  const others = carriedMembers.filter((m) => m.id !== ownerUid);
  const openingRecords = input.carryBalances
    ? carriedMembers
        .map((m) => ({ m, balance: source.balances.get(m.id) ?? 0 }))
        .filter(({ balance }) => Number.isSafeInteger(balance) && balance !== 0 && Math.abs(balance) <= 100_000_000)
        .map(({ m, balance }) =>
          buildRecord('OPENING', balance, ownerUid, {
            memberId: m.id,
            memberName: m.name,
            note: `Carried over from ${source.room.name}`.slice(0, 200),
            dateMillis: now,
          }),
        )
    : [];

  const copiedMemberIds: string[] = [];
  const copiedRecordIds: string[] = [];
  let summaryWritten = false;

  try {
    // 2. Copy all other members (keeping their role and sortName; courses start fresh).
    for (let i = 0; i < others.length; i += BATCH_LIMIT) {
      const slice = others.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const m of slice) {
        const roleId = validRoleIds.has(m.roleId) ? m.roleId : defaultRoleId;
        const entry: Record<string, unknown> = {
          uid: m.id,
          name: m.name.trim().slice(0, 90) || 'Member',
          roleId,
          joinedAtMillis: now,
          excludedCourseIds: [],
          approvedByUid: ownerUid,
        };
        if (m.sortName) entry.sortName = m.sortName.slice(0, 100);
        batch.set(memberRef(db, classId, m.id), entry);
      }
      await batch.commit();
      for (const m of slice) copiedMemberIds.push(m.id);
    }

    // 3. Carry over non-zero closing balances as OPENING records + write fund summary.
    const summaryData = { ...Ledger.summarize(openingRecords), updatedAtMillis: nowMillis() };
    if (openingRecords.length === 0) {
      const summaryBatch = writeBatch(db);
      summaryBatch.set(summaryRef(db, classId), summaryData);
      await summaryBatch.commit();
      summaryWritten = true;
    } else {
      for (let i = 0; i < openingRecords.length; i += BATCH_LIMIT) {
        const slice = openingRecords.slice(i, i + BATCH_LIMIT);
        const isLast = i + BATCH_LIMIT >= openingRecords.length;
        const batch = writeBatch(db);
        for (const rec of slice) {
          batch.set(recordRef(db, classId, `opening-${rec.memberId}`), withoutId(rec));
        }
        if (isLast) batch.set(summaryRef(db, classId), summaryData);
        await batch.commit();
        for (const rec of slice) copiedRecordIds.push(`opening-${rec.memberId}`);
        if (isLast) summaryWritten = true;
      }
    }
  } catch (err) {
    // Best-effort rollback so a mid-rollover failure never leaves a half-made class behind.
    try {
      const closeBatch = writeBatch(db);
      closeBatch.update(classRef(db, classId), { deletingAtMillis: nowMillis() });
      closeBatch.delete(inviteRef(db, code));
      await closeBatch.commit();

      const cleanupRefs = [
        doc(db, 'classes', classId, 'rollover', 'source'),
        ...(summaryWritten ? [summaryRef(db, classId)] : []),
        ...copiedRecordIds.map((rid) => recordRef(db, classId, rid)),
        ...copiedMemberIds.map((uid) => memberRef(db, classId, uid)),
      ];
      for (let i = 0; i < cleanupRefs.length; i += BATCH_LIMIT) {
        const b = writeBatch(db);
        for (const r of cleanupRefs.slice(i, i + BATCH_LIMIT)) b.delete(r);
        await b.commit();
      }

      const finalBatch = writeBatch(db);
      for (const role of roles) finalBatch.delete(roleRef(db, classId, role.id));
      finalBatch.delete(memberRef(db, classId, ownerUid));
      finalBatch.delete(classRef(db, classId));
      await finalBatch.commit();
    } catch {
      // Ignore cleanup errors and surface the original failure.
    }
    throw err;
  }

  return {
    classId,
    inviteCode: code,
    copiedMembers: source.members.length,
    copiedBalances: openingRecords.length,
  };
}

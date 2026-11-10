import {
  getDoc,
  getDocFromServer,
  getDocsFromServer,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import {
  BALANCE_VISIBILITIES,
  ROLE_MAYOR,
  ROLE_MEMBER,
  newClassRoom,
  newMember,
  type BalanceVisibility,
  type ClassRoom,
} from './models';
import { DefaultRoles } from '../domain/permissions';
import { ClassRules } from '../domain/classRules';
import { Ledger } from '../domain/ledger';
import { UserError } from './errors';
import { newId, newInviteCode, nowMillis } from './dataEnv';
import {
  CLASS_SUBCOLLECTIONS,
  classPhotoRef,
  classRef,
  classSubCol,
  explainRefusal,
  inviteRef,
  isDenied,
  memberRef,
  readOpenClass,
  roleRef,
  rolesCol,
  summaryRef,
  toClassRoom,
  toRecord,
  withoutId,
} from './paths';

/*
 * Classes: creating one, its settings, its invite code and deleting it (docs/PLAN-V2.md, "Data model (v2)"
 * and "Deleting a class"). Each batch has the shape firestore.rules asks for.
 */

export interface Actor {
  uid: string;
  /** The name shown in the class (the profile's display name). */
  name: string;
}

const MAX_CODE_TRIES = 5;

/** An invite code no class uses yet. Anyone signed in may read one invite, so this asks the server. */
async function unusedInviteCode(db: Firestore): Promise<string> {
  for (let i = 0; i < MAX_CODE_TRIES; i++) {
    const code = newInviteCode();
    if (!(await getDoc(inviteRef(db, code))).exists()) return code;
  }
  throw new UserError('INVITE_CODE_UNAVAILABLE');
}

function checkMemberName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new UserError('NAME_MISSING');
  if (trimmed.length > 90) throw new UserError('NAME_TOO_LONG');
  return trimmed;
}

export interface NewClassInput {
  name: string;
  description?: string;
  accentColor?: string;
}

/**
 * Creates a class: the class document with every v2 field, the four default roles, the creator's Mayor entry
 * and the invite, in one batch (the rules check the creator's entry with getAfter, so they must go together).
 * The empty fund summary follows in a second batch: its rule asks whether the writer is already a member, and
 * the rules read the state before a batch, so it cannot be in the first one. Both are queued in order, so this
 * also works offline once the invite code is chosen.
 */
export async function createClass(db: Firestore, actor: Actor, input: NewClassInput): Promise<{ classId: string; inviteCode: string }> {
  const nameProblem = ClassRules.checkName(input.name);
  if (nameProblem) throw new UserError('CLASS_NAME_MISSING', nameProblem);
  const ownerName = checkMemberName(actor.name);
  const code = await unusedInviteCode(db);
  const classId = newId();
  const now = nowMillis();
  const room: ClassRoom = newClassRoom({
    id: classId,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    ownerUid: actor.uid,
    accentColor: input.accentColor ?? newClassRoom({}).accentColor,
    inviteCode: code,
    defaultRoleId: ROLE_MEMBER,
    deletingAtMillis: 0,
    createdAtMillis: now,
  });

  const first = writeBatch(db);
  first.set(classRef(db, classId), withoutId(room));
  for (const role of DefaultRoles.all()) first.set(roleRef(db, classId, role.id), withoutId(role));
  first.set(memberRef(db, classId, actor.uid), withoutId(newMember({ uid: actor.uid, name: ownerName, roleId: ROLE_MAYOR, joinedAtMillis: now })));
  first.set(inviteRef(db, code), { classId, className: room.name });

  const second = writeBatch(db);
  second.set(summaryRef(db, classId), {
    cashOnHandCentavos: 0, waitingPayoutCentavos: 0, balancesTotalCentavos: 0, recordCount: 0, updatedAtMillis: now,
  });

  const created = first.commit();
  // A missing summary is not fatal: the first record creates it with its increments.
  const summarized = second.commit().catch(() => undefined);
  await created;
  await summarized;
  return { classId, inviteCode: code };
}

/** The fields CLASS_SETTINGS may change. */
export interface ClassSettingsChanges {
  name?: string;
  description?: string;
  accentColor?: string;
  ledgerEnabled?: boolean;
  scheduleEnabled?: boolean;
  contentsEnabled?: boolean;
  announcementsEnabled?: boolean;
  timetableEnabled?: boolean;
  scheduleIcons?: Record<string, string>;
  scheduleColors?: Record<string, string>;
  contentIcons?: Record<string, string>;
  contentColors?: Record<string, string>;
}

/**
 * Saves class settings (CLASS_SETTINGS). A new name is copied to the invite in the same batch, because
 * someone holding the code cannot read the class.
 */
export async function updateClassSettings(db: Firestore, classId: string, changes: ClassSettingsChanges): Promise<void> {
  const room = await readOpenClass(db, classId);
  const patch: Record<string, string | boolean | Record<string, string>> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    patch[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (patch.name !== undefined) {
    const problem = ClassRules.checkName(String(patch.name));
    if (problem) throw new UserError('CLASS_NAME_MISSING', problem);
  }
  if (Object.keys(patch).length === 0) return;
  const batch = writeBatch(db);
  batch.update(classRef(db, classId), patch);
  if (patch.name !== undefined && patch.name !== room.name && room.inviteCode) {
    const invite = await getDoc(inviteRef(db, room.inviteCode)).catch(() => null);
    if (invite?.exists() && invite.get('classId') === classId) batch.update(invite.ref, { className: patch.name });
  }
  await explainRefusal(db, classId, () => batch.commit());
}

/** Who sees every balance, and where to send money (RECORDS_MANAGE). */
export async function updateLedgerSettings(
  db: Firestore,
  classId: string,
  changes: { balanceVisibility?: BalanceVisibility; paymentInfo?: string },
): Promise<void> {
  const patch: Record<string, string | boolean | Record<string, string>> = {};
  if (changes.balanceVisibility !== undefined) {
    if (!BALANCE_VISIBILITIES.includes(changes.balanceVisibility)) throw new UserError('BAD_VISIBILITY');
    patch.balanceVisibility = changes.balanceVisibility;
  }
  if (changes.paymentInfo !== undefined) {
    const info = changes.paymentInfo.trim();
    if (info.length > 500) throw new UserError('PAYMENT_INFO_TOO_LONG');
    patch.paymentInfo = info;
  }
  if (Object.keys(patch).length === 0) return;
  await readOpenClass(db, classId);
  await explainRefusal(db, classId, () => updateDoc(classRef(db, classId), patch));
}

/**
 * Replaces the invite code (MEMBERS_MANAGE): the old invite is deleted, the new one created and the class
 * updated, in one batch. People already in the class stay; the old code stops working for new requests.
 */
export async function regenerateInviteCode(db: Firestore, classId: string): Promise<string> {
  const room = await readOpenClass(db, classId);
  const code = await unusedInviteCode(db);
  const batch = writeBatch(db);
  if (room.inviteCode) {
    // Deleting an invite that is already gone would be refused (the rule reads its classId).
    const old = await getDoc(inviteRef(db, room.inviteCode)).catch(() => null);
    if (old?.exists() && old.get('classId') === classId) batch.delete(old.ref);
  }
  batch.set(inviteRef(db, code), { classId, className: room.name });
  batch.update(classRef(db, classId), { inviteCode: code });
  await explainRefusal(db, classId, () => batch.commit());
  return code;
}

// ---- Deleting a class

export interface DeleteProgress {
  /** closing: checking the books and setting deletingAtMillis; deleting: removing documents; done: the class is gone. */
  step: 'closing' | 'deleting' | 'done';
  /** Documents deleted so far in this run. */
  deleted: number;
  /** Documents this run expects to delete (grows if more are found on a later pass). */
  total: number;
}

/** At most this many deletes per batch (Firestore allows 500 writes; the brief keeps a margin). */
export const DELETE_BATCH_SIZE = 400;
const MAX_PASSES = 5;

/**
 * The Mayor deletes the class for everyone (docs/PLAN-V2.md, "Deleting a class").
 *
 * 1. If the delete has not started: checks against the server that everyone is settled and the fund is
 *    empty, then sets deletingAtMillis. From then on the books are closed and it cannot be undone.
 * 2. Deletes every document in the class's sub-collections in batches of at most 400, the class photo too,
 *    keeping back the Mayor's own member entry and the roles.
 * 3. One last batch: the Mayor's entry, the roles, the invite and the class itself (the rules only allow
 *    those to go together with the class).
 *
 * Safe to run again after an interruption: a class with deletingAtMillis set skips step 1 and carries on.
 * onProgress is called after every batch; if it throws, the delete stops there (the next run finishes it).
 */
export async function deleteClass(
  db: Firestore,
  ownerUid: string,
  classId: string,
  onProgress: (p: DeleteProgress) => void = () => undefined,
): Promise<void> {
  let deleted = 0;
  let total = 0;
  const report = (step: DeleteProgress['step']) => onProgress({ step, deleted, total });

  const snap = await getDocFromServer(classRef(db, classId)).catch((e) => {
    if (isDenied(e)) throw new UserError('ONLY_MAYOR_DELETES');
    throw e;
  });
  if (!snap.exists()) {
    report('done');
    return;
  }
  const room = toClassRoom(snap);
  if (room.ownerUid !== ownerUid) throw new UserError('ONLY_MAYOR_DELETES');

  if (room.deletingAtMillis === 0) {
    report('closing');
    const records = await getDocsFromServer(classSubCol(db, classId, 'records'));
    if (!Ledger.canCloseBooks(records.docs.map(toRecord))) throw new UserError('NOT_SETTLED');
    await updateDoc(classRef(db, classId), { deletingAtMillis: nowMillis() });
  }

  const keep = new Set<string>([memberRef(db, classId, ownerUid).path]);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const lists = await Promise.all(CLASS_SUBCOLLECTIONS.map((name) => getDocsFromServer(classSubCol(db, classId, name))));
    const refs: DocumentReference[] = [];
    lists.forEach((list, i) => {
      // Roles go in the last batch (the Mayor and default roles cannot be deleted before the class).
      if (CLASS_SUBCOLLECTIONS[i] === 'roles') return;
      for (const d of list.docs) if (!keep.has(d.ref.path)) refs.push(d.ref);
    });
    if (pass === 0) {
      const photo = await getDoc(classPhotoRef(db, classId)).catch(() => null);
      if (photo?.exists()) refs.push(photo.ref);
    }
    if (refs.length === 0) break;
    total += refs.length;
    for (let i = 0; i < refs.length; i += DELETE_BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = refs.slice(i, i + DELETE_BATCH_SIZE);
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      deleted += chunk.length;
      report('deleting');
    }
  }

  const [roles, invite] = await Promise.all([
    getDocsFromServer(rolesCol(db, classId)),
    room.inviteCode ? getDocFromServer(inviteRef(db, room.inviteCode)).catch(() => null) : Promise.resolve(null),
  ]);
  const last = writeBatch(db);
  roles.docs.forEach((d) => last.delete(d.ref));
  // An invite that is already gone, or that another class took over, must not be in the batch.
  if (invite?.exists() && invite.get('classId') === classId) last.delete(invite.ref);
  last.delete(memberRef(db, classId, ownerUid));
  last.delete(classRef(db, classId));
  await last.commit();
  deleted += roles.size + 2 + (invite?.exists() ? 1 : 0);
  total = Math.max(total, deleted);
  report('done');
}

/** The Mayor's own classes whose delete was started but not finished; the app finishes them when it opens. */
export function unfinishedDeletes(rooms: (ClassRoom | null | undefined)[], uid: string): ClassRoom[] {
  return rooms.filter((r): r is ClassRoom => !!r && r.ownerUid === uid && r.deletingAtMillis > 0);
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../data/firebase';
import { fromDoc, useDocValue, useQueryList } from '../../data/live';
import { friendlyMessage, isPermissionDenied } from '../../data/errors';
import * as classRepo from '../../data/classRepo';
import * as dataRepo from '../../data/classDataRepo';
import * as photoRepo from '../../data/photoRepo';
import {
  newClassRoom,
  newContentItem,
  newMember,
  newRecord,
  newRole,
  newScheduleItem,
  type ClassMembership,
  type ClassRoom,
  type ContentItem,
  type Course,
  type LedgerRecord,
  type Member,
  type Permission,
  type Role,
  type ScheduleItem,
  type StudentProgress,
} from '../../data/models';
import { Ledger } from '../../domain/ledger';
import { can as roleCan, RoleRules } from '../../domain/permissions';
import { ClassRules, CourseRules, MemberRules, compareStrings, sortByName } from '../../domain/classRules';
import { LedgerForms } from '../../domain/ledgerForms';
import { ChargePlanner, type ChargePreview } from '../../domain/chargePlanner';
import type { ChargeBatch } from '../../domain/ledgerView';
import { formatMoney } from '../../domain/money';
import { ScheduleForms } from '../../domain/scheduleView';
import { ScheduleLogic } from '../../domain/scheduleLogic';
import { ContentRules } from '../../domain/contentRules';
import { ContentIcons, ScheduleIcons } from '../../domain/iconStyles';
import { useNotice } from '../common';

/** Everything the class screens show, kept live from Firestore (the Android ClassUiState). */
export interface ClassState {
  classId: string;
  myUid: string;
  loading: boolean;
  room: ClassRoom | null;
  me: Member | null;
  roles: Role[];
  members: Member[];
  courses: Course[];
  records: LedgerRecord[];
  contents: ContentItem[];
  schedule: ScheduleItem[];
  /** Schedule items the signed-in student marked done. */
  myDone: Set<string>;
  /** Every student's done marks. */
  progress: StudentProgress[];
  avatars: Map<string, string>;
  classPhoto: string | null;
  error: string | null;
  balances: Map<string, number>;
  /** The class is gone, or this user is no longer in it. */
  removed: boolean;
  myRole: Role | null;
  balanceOf: (memberId: string) => number;
  roleOf: (member: Member | null | undefined) => Role | null;
  can: (permission: Permission) => boolean;
}

type Done = () => void;

/** The officer and member actions (the Android ClassViewModel). Each checks permission first and reports through the snackbar. */
export interface ClassActions {
  busy: boolean;
  showNotice: (message: string) => void;
  regenerateInviteCode: () => void;
  saveSettings: (updated: ClassRoom, onDone?: Done) => void;
  setClassPhoto: (photo: string) => void;
  removeClassPhoto: () => void;
  setRole: (member: Member, roleId: string, onDone?: Done) => void;
  setCoursesTaken: (member: Member, taken: Set<string>, onDone?: Done) => void;
  removeMember: (member: Member, onDone?: Done) => void;
  leaveClass: (newMayorUid: string | null, onDone: Done) => void;
  saveRole: (role: Role, onDone?: Done) => void;
  deleteRole: (role: Role, onDone?: Done) => void;
  addCourse: (name: string, onDone?: Done) => void;
  renameCourse: (course: Course, name: string, onDone?: Done) => void;
  deleteCourse: (course: Course, onDone?: Done) => void;
  addRecord: (record: LedgerRecord, onDone?: Done) => void;
  addPayout: (charge: ChargeBatch | null, paidTo: string, dateMillis: number, onDone?: Done) => void;
  chargeStudents: (preview: ChargePreview, note: string, courseId: string, dateMillis: number, payNow: boolean, paidTo: string, onDone?: Done) => void;
  deleteRecord: (record: LedgerRecord) => void;
  undoCharge: (batch: ChargeBatch) => void;
  saveScheduleItem: (item: ScheduleItem, onDone?: Done) => void;
  setCancelled: (item: ScheduleItem, cancelled: boolean) => void;
  setDone: (item: ScheduleItem, done: boolean) => void;
  deleteScheduleItem: (item: ScheduleItem, onDone?: Done) => void;
  saveContent: (item: ContentItem, onDone?: Done) => void;
  deleteContent: (item: ContentItem, onDone?: Done) => void;
  forgetClass: () => void;
}

const ClassContext = createContext<{ state: ClassState; actions: ClassActions } | null>(null);

export function useClass(): { state: ClassState; actions: ClassActions } {
  const value = useContext(ClassContext);
  if (!value) throw new Error('useClass is used outside a class');
  return value;
}

const s = (n: number) => (n === 1 ? '' : 's');

export function ClassProvider({ classId, uid, children }: { classId: string; uid: string; children: ReactNode }) {
  const room = useDocValue(`class/${classId}`, classRepo.classDoc(classId), (d) => fromDoc(newClassRoom({}), d));
  const me = useDocValue(`me/${classId}/${uid}`, doc(classRepo.membersOf(classId), uid), (d) => fromDoc(newMember({}), d));
  // The other lists are read only while the user is a member; the rules refuse them otherwise.
  const allowed = !!me.data;
  const roles = useQueryList(`roles/${classId}/${allowed}`, allowed ? classRepo.rolesOf(classId) : null, (d) => fromDoc(newRole({}), d));
  const members = useQueryList(`members/${classId}/${allowed}`, allowed ? classRepo.membersOf(classId) : null, (d) => fromDoc(newMember({}), d));
  const courses = useQueryList(`courses/${classId}/${allowed}`, allowed ? classRepo.coursesOf(classId) : null, (d) => fromDoc<Course>({ id: '', name: '' }, d));
  const records = useQueryList(`records/${classId}/${allowed}`, allowed ? dataRepo.recordsOf(classId) : null, (d) => fromDoc(newRecord({}), d));
  const contents = useQueryList(`contents/${classId}/${allowed}`, allowed ? dataRepo.contentsOf(classId) : null, (d) => fromDoc(newContentItem({}), d));
  const schedule = useQueryList(`schedule/${classId}/${allowed}`, allowed ? dataRepo.scheduleOf(classId) : null, (d) => fromDoc(newScheduleItem({}), d));
  const progress = useQueryList(`progress/${classId}/${allowed}`, allowed ? dataRepo.progressOf(classId) : null, (d) =>
    fromDoc<StudentProgress>({ id: '', done: {} }, d),
  );
  const classPhoto = useDocValue(`classPhoto/${classId}/${allowed}`, allowed ? doc(db, 'classPhotos', classId) : null, (d) =>
    typeof d.get('photo') === 'string' ? (d.get('photo') as string) : null,
  );
  const membership = useDocValue(`membership/${uid}/${classId}`, doc(classRepo.membershipsOf(uid), classId), (d) => (d.get('className') as string | undefined) ?? '');
  const memberIds = useMemo(() => (members.data ?? []).map((m) => m.id), [members.data]);

  const avatars = photoRepo.useAvatars(memberIds);

  const state = useMemo<ClassState>(() => {
    const coreErrors = [room.error, me.error, roles.error, members.error, courses.error, records.error, contents.error, schedule.error].filter(Boolean);
    const denied = coreErrors.some(isPermissionDenied);
    const otherError = coreErrors.find((e) => !isPermissionDenied(e));
    const meValue = me.data ?? null;
    const lists = [roles, members, courses, records, contents, schedule];
    const loading = !denied && !otherError && (room.data === undefined || me.data === undefined || (meValue !== null && lists.some((l) => l.data === undefined)));
    const memberList = sortByName(members.data ?? []);
    const recordList = Ledger.withCurrentNames([...(records.data ?? [])].sort((a, b) => b.dateMillis - a.dateMillis), memberList);
    const roleList = [...(roles.data ?? [])].sort(
      (a, b) => Number(b.locked) - Number(a.locked) || compareStrings(a.name.toLowerCase(), b.name.toLowerCase()),
    );
    const roomValue = denied ? null : room.data ?? null;
    const progressList = progress.data ?? [];
    const mine = progressList.find((p) => p.id === uid);
    const balances = Ledger.memberBalances(memberList, recordList);
    const roleOf = (m: Member | null | undefined) => (m ? roleList.find((r) => r.id === m.roleId) ?? null : null);
    const myRole = roleOf(meValue);
    const error = otherError ? friendlyMessage(otherError) : null;
    return {
      classId,
      myUid: uid,
      loading,
      room: roomValue,
      me: denied ? null : meValue,
      roles: roleList,
      members: memberList,
      courses: [...(courses.data ?? [])].sort((a, b) => compareStrings(a.name.toLowerCase(), b.name.toLowerCase())),
      records: recordList,
      contents: contents.data ?? [],
      schedule: [...(schedule.data ?? [])].sort((a, b) => a.dueMillis - b.dueMillis),
      myDone: new Set(Object.keys(mine?.done ?? {})),
      progress: progressList,
      avatars,
      classPhoto: classPhoto.data ?? null,
      error,
      balances,
      removed: !loading && !error && (roomValue === null || meValue === null || denied),
      myRole,
      balanceOf: (id) => balances.get(id) ?? 0,
      roleOf,
      can: (p) => roleCan(myRole, p),
    };
  }, [classId, uid, room, me, roles, members, courses, records, contents, schedule, progress, avatars, classPhoto]);

  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Keeps this class in My classes while the user is a member: puts it back if it went missing, and brings
  // the name up to date after an officer renames the class. Skipped while an action (such as leaving) runs.
  const liveName = me.data ? room.data?.name : undefined;
  const joinedAt = me.data?.joinedAtMillis ?? 0;
  useEffect(() => {
    if (!liveName || busy) return;
    const entry = doc(classRepo.membershipsOf(uid), classId);
    if (membership.data === null) {
      setDoc(entry, { classId: '', className: liveName, joinedAtMillis: joinedAt } satisfies ClassMembership).catch(() => {});
    } else if (typeof membership.data === 'string' && membership.data !== liveName) {
      setDoc(entry, { className: liveName }, { merge: true }).catch(() => {});
    }
  }, [liveName, joinedAt, membership.data, busy, uid, classId]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runAction = useCallback(
    (success: string | null, onDone: Done | undefined, block: () => Promise<unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      block()
        .then(() => {
          if (success) notice(success);
          onDone?.();
        })
        .catch((e) => notice(friendlyMessage(e)))
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [notice],
  );

  const actions = useMemo<ClassActions>(() => {
    const st = () => stateRef.current;
    const deny = (message: string) => notice(message);
    return {
      busy,
      showNotice: notice,

      regenerateInviteCode() {
        const r = st().room;
        if (!r) return;
        runAction(null, undefined, async () => {
          const code = await classRepo.regenerateInviteCode(r);
          notice(`New invite code: ${code}. The old code no longer works.`);
        });
      },

      // ---- Class settings ----

      saveSettings(updated, onDone) {
        const c = st();
        if (!c.room) return;
        if (!c.can('CLASS_SETTINGS')) return deny('You do not have permission to change class settings.');
        const problem = ClassRules.checkName(updated.name);
        if (problem) return deny(problem);
        // Only the editable fields change; everything else comes from the live class.
        const next: ClassRoom = {
          ...c.room,
          name: updated.name.trim(),
          description: updated.description.trim(),
          accentColor: updated.accentColor,
          ledgerEnabled: updated.ledgerEnabled,
          scheduleEnabled: updated.scheduleEnabled,
          contentsEnabled: updated.contentsEnabled,
          scheduleIcons: ScheduleIcons.sanitize(updated.scheduleIcons),
          scheduleColors: ScheduleIcons.sanitizeColors(updated.scheduleColors),
          contentIcons: ContentIcons.sanitize(updated.contentIcons),
          contentColors: ContentIcons.sanitizeColors(updated.contentColors),
        };
        runAction('Class settings saved.', onDone, () => classRepo.updateSettings(next, uid));
      },

      setClassPhoto(photo) {
        if (!st().can('CLASS_SETTINGS')) return deny('You do not have permission to change the class photo.');
        runAction('Class photo updated.', undefined, () => photoRepo.setClassPhoto(classId, photo));
      },

      removeClassPhoto() {
        if (!st().can('CLASS_SETTINGS')) return deny('You do not have permission to change the class photo.');
        runAction('Class photo removed.', undefined, () => photoRepo.removeClassPhoto(classId));
      },

      // ---- Members ----

      setRole(member, roleId, onDone) {
        const c = st();
        const ownerUid = c.room?.ownerUid ?? '';
        if (!c.can('MEMBERS_MANAGE')) return deny('You do not have permission to change roles.');
        if (!MemberRules.canChangeRole(uid, member, ownerUid)) return deny("This member's role cannot be changed.");
        if (!MemberRules.assignableRoles(c.roles).some((r) => r.id === roleId)) return deny("Pick one of the class's roles.");
        runAction(`${member.name}'s role was updated.`, onDone, () => classRepo.setRole(classId, member.id, roleId));
      },

      setCoursesTaken(member, taken, onDone) {
        const c = st();
        if (!c.can('MEMBERS_MANAGE')) return deny('You do not have permission to change courses.');
        const excluded = c.courses.map((x) => x.id).filter((id) => !taken.has(id));
        runAction(`${member.name}'s courses were saved.`, onDone, () => classRepo.setExcludedCourses(classId, member.id, excluded));
      },

      removeMember(member, onDone) {
        const c = st();
        if (!c.can('MEMBERS_MANAGE')) return deny('You do not have permission to remove members.');
        if (!MemberRules.canRemove(uid, member, c.room?.ownerUid ?? '')) return deny('This member cannot be removed.');
        runAction(`${member.name} was removed from the class.`, onDone, () => classRepo.removeMember(classId, member.id));
      },

      leaveClass(newMayorUid, onDone) {
        const c = st();
        const handOver = MemberRules.mustHandOver(uid, c.room?.ownerUid ?? '');
        if (!handOver) return runAction(null, onDone, () => classRepo.leaveClass(classId, uid));
        if (!newMayorUid) return deny('Choose the new Mayor before you leave.');
        if (!MemberRules.mayorCandidates(uid, c.members).some((m) => m.id === newMayorUid)) return deny('Choose someone who is still in the class.');
        runAction(null, onDone, () => classRepo.handOverAndLeave(classId, uid, newMayorUid));
      },

      // ---- Roles ----

      saveRole(role, onDone) {
        const c = st();
        if (!c.can('ROLES_MANAGE')) return deny('You do not have permission to edit roles.');
        if (!RoleRules.canEdit(role)) return deny(`The ${role.name} role cannot be changed.`);
        if (!RoleRules.isNameValid(role.name, c.roles, role.id)) return deny('Use a role name of up to 24 characters that no other role uses.');
        runAction(`Role "${role.name.trim()}" saved.`, onDone, () => classRepo.saveRole(classId, { ...role, name: role.name.trim() }));
      },

      deleteRole(role, onDone) {
        const c = st();
        const defaultRoleId = c.room?.defaultRoleId ?? '';
        if (!c.can('ROLES_MANAGE')) return deny('You do not have permission to delete roles.');
        if (!RoleRules.canDelete(role, defaultRoleId)) return deny(`The ${role.name} role cannot be deleted.`);
        runAction(`Role "${role.name}" deleted.`, onDone, () => classRepo.deleteRole(classId, role, defaultRoleId));
      },

      // ---- Courses ----

      addCourse(name, onDone) {
        const c = st();
        if (!c.can('CLASS_SETTINGS')) return deny('You do not have permission to edit courses.');
        if (!CourseRules.isNameValid(name, c.courses)) return deny(`Use a course name of up to ${CourseRules.MAX_NAME} characters that is not already listed.`);
        runAction(`Added ${name.trim()}.`, onDone, () => classRepo.addCourse(classId, name));
      },

      renameCourse(course, name, onDone) {
        const c = st();
        if (!c.can('CLASS_SETTINGS')) return deny('You do not have permission to edit courses.');
        if (!CourseRules.isNameValid(name, c.courses, course.id)) return deny(`Use a course name of up to ${CourseRules.MAX_NAME} characters that is not already listed.`);
        runAction(`Renamed to ${name.trim()}.`, onDone, () => classRepo.renameCourse(classId, course.id, name));
      },

      deleteCourse(course, onDone) {
        if (!st().can('CLASS_SETTINGS')) return deny('You do not have permission to edit courses.');
        runAction(`Deleted ${course.name}.`, onDone, () => classRepo.deleteCourse(classId, course.id));
      },

      // ---- Ledger ----

      addRecord(record, onDone) {
        const c = st();
        if (!c.can('RECORDS_MANAGE')) return deny('You do not have permission to add ledger records.');
        const error = LedgerForms.checkRecord(
          record.type,
          record.amountCentavos > 0 ? record.amountCentavos : null,
          record.memberId,
          record.memberId ? c.balanceOf(record.memberId) : null,
        );
        if (error) return deny(error);
        const label =
          record.type === 'WITHDRAWAL'
            ? `Withdrawal of ${formatMoney(record.amountCentavos)} by ${record.memberName} saved.`
            : `Payment of ${formatMoney(record.amountCentavos)} from ${record.memberName} saved.`;
        runAction(label, onDone, () => dataRepo.addRecord(classId, { ...record, createdByUid: uid }));
      },

      addPayout(charge, paidTo, dateMillis, onDone) {
        const c = st();
        if (!c.can('RECORDS_MANAGE')) return deny('You do not have permission to record pay-outs.');
        const alreadyPaid = !!charge && Ledger.paidOutBatchIds(c.records).has(charge.batchId);
        const problem = LedgerForms.checkPayout(charge, alreadyPaid);
        if (problem || !charge) return deny(problem ?? 'Choose the charge this pay-out is for.');
        const payout = { ...ChargePlanner.buildPayout(charge.batchId, charge.totalCentavos, charge.note, dateMillis, paidTo), createdByUid: uid };
        runAction(`Paid out ${formatMoney(charge.totalCentavos)} for "${charge.note}".`, onDone, () => dataRepo.addRecord(classId, payout));
      },

      chargeStudents(preview, note, courseId, dateMillis, payNow, paidTo, onDone) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to charge students.');
        const problem = LedgerForms.checkCharge(preview.perMemberCentavos > 0 ? preview.perMemberCentavos : null, note, preview.charged.length);
        if (problem) return deny(problem);
        const batchId = crypto.randomUUID();
        const charges = ChargePlanner.buildRecords(preview, note.trim(), courseId, dateMillis, batchId);
        const payout = payNow ? [ChargePlanner.buildPayout(batchId, preview.totalCentavos, note.trim(), dateMillis, paidTo)] : [];
        const all = [...charges, ...payout].map((r) => ({ ...r, createdByUid: uid }));
        const n = preview.charged.length;
        const message =
          `Charged ${n} student${s(n)} ${formatMoney(preview.perMemberCentavos)} each (${formatMoney(preview.totalCentavos)} in total)` +
          (payNow ? ' and recorded the pay-out.' : '.');
        runAction(message, onDone, () => dataRepo.addRecords(classId, all));
      },

      deleteRecord(record) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to delete ledger records.');
        if (record.type === 'CHARGE' && record.batchId) return deny('This is part of a charge to several students. Use Undo charge on the charge instead.');
        const message = record.type === 'EXPENSE' ? 'Pay-out deleted. Its charge is waiting to be paid out again.' : 'Record deleted.';
        runAction(message, undefined, () => dataRepo.deleteRecord(classId, record.id));
      },

      undoCharge(batch) {
        const c = st();
        if (!c.can('RECORDS_MANAGE')) return deny('You do not have permission to undo charges.');
        if (Ledger.paidOutBatchIds(c.records).has(batch.batchId)) {
          return deny('This charge has already been paid out. Delete its pay-out first, then undo the charge.');
        }
        runAction(`Charge "${batch.note}" undone for ${batch.count} student${s(batch.count)}.`, undefined, () => dataRepo.deleteChargeBatch(classId, batch.batchId));
      },

      // ---- Schedule ----

      saveScheduleItem(item, onDone) {
        if (!st().can('SCHEDULE_MANAGE')) return deny('You do not have permission to manage the schedule.');
        const problem = ScheduleForms.check(item.title);
        if (problem) return deny(problem);
        const clean = { ...item, title: item.title.trim(), note: item.note.trim() };
        if (!clean.id) runAction(`Added "${clean.title}".`, onDone, () => dataRepo.addScheduleItem(classId, { ...clean, createdByUid: uid }));
        else runAction(`Saved "${clean.title}".`, onDone, () => dataRepo.updateScheduleItem(classId, clean));
      },

      setCancelled(item, cancelled) {
        if (!st().can('SCHEDULE_MANAGE')) return deny('You do not have permission to manage the schedule.');
        const message = cancelled ? `"${item.title}" is cancelled for the class.` : `"${item.title}" is active again.`;
        runAction(message, undefined, () => dataRepo.setScheduleStatus(classId, item.id, cancelled ? 'CANCELLED' : 'PENDING'));
      },

      setDone(item, done) {
        if (ScheduleLogic.isCancelled(item)) return deny('This item was cancelled, so there is nothing to mark.');
        const message = done ? `Marked "${item.title}" as done.` : `Marked "${item.title}" as not done.`;
        runAction(message, undefined, () => (done ? dataRepo.markDone(classId, uid, item.id) : dataRepo.markNotDone(classId, uid, item.id)));
      },

      deleteScheduleItem(item, onDone) {
        if (!st().can('SCHEDULE_MANAGE')) return deny('You do not have permission to manage the schedule.');
        runAction(`Deleted "${item.title}".`, onDone, () => dataRepo.deleteScheduleItem(classId, item.id));
      },

      // ---- Class contents ----

      saveContent(item, onDone) {
        if (!st().can('CONTENTS_MANAGE')) return deny('You do not have permission to manage class contents.');
        const problem = ContentRules.check(item.title, item.url);
        if (problem) return deny(problem);
        const clean = { ...item, title: item.title.trim(), url: ContentRules.normalizeUrl(item.url), note: item.note.trim() };
        if (!clean.id) {
          runAction(`Added "${clean.title}".`, onDone, () => dataRepo.addContent(classId, { ...clean, createdByUid: uid, createdAtMillis: Date.now() }));
        } else runAction(`Saved "${clean.title}".`, onDone, () => dataRepo.updateContent(classId, clean));
      },

      deleteContent(item, onDone) {
        if (!st().can('CONTENTS_MANAGE')) return deny('You do not have permission to manage class contents.');
        runAction(`Deleted "${item.title}".`, onDone, () => dataRepo.deleteContent(classId, item.id));
      },

      forgetClass() {
        classRepo.forgetMembership(uid, classId).catch(() => {});
      },
    };
  }, [busy, classId, uid, notice, runAction]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <ClassContext.Provider value={value}>{children}</ClassContext.Provider>;
}

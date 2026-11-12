import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../data/firebase';
import { fromDoc, useDocValue, useQueryList } from '../../data/live';
import { friendlyMessage, isPermissionDenied } from '../../data/errors';
import * as classRepo from '../../data/classRepo';
import * as classes from '../../data/classes';
import * as membership from '../../data/membership';
import * as ledgerStore from '../../data/ledgerStore';
import * as openings from '../../data/openingBalances';
import { useCharges, useFundSummary, useJoinRequests, useLedgerUpkeep, usePendingOpeningBalances, useVisibleRecords } from '../../data/hooks';
import * as dataRepo from '../../data/classDataRepo';
import { queueNotice } from '../../data/notify';
import * as photoRepo from '../../data/photoRepo';
import {
  newClassRoom,
  newContentItem,
  newMember,
  sortNameOf,
  newRole,
  newScheduleItem,
  type BalanceVisibility,
  type Charge,
  type ClassRoom,
  type ContentItem,
  type JoinRequest,
  type PendingOpeningBalance,
  type StoredFundSummary,
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
import { type ChargePreview } from '../../domain/chargePlanner';
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
  /** The records this user may read: all of them, or only their own plus the pay-outs (see seeAll). */
  records: LedgerRecord[];
  /** True when this user may read every record (and so every balance). */
  seeAll: boolean;
  /** The fund totals kept by the treasurers, readable by every member. */
  summary: StoredFundSummary | null;
  charges: Charge[];
  /** Students waiting for approval (empty unless this user manages members). */
  joinRequests: JoinRequest[];
  /** Opening balances waiting for a student to join (records managers only). */
  pendingOpenings: PendingOpeningBalance[];
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
  /** False only for a course this user does not take. Items with no course belong to everyone. */
  takes: (courseId: string | null | undefined) => boolean;
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
  deleteClass: (onDone: Done) => void;
  saveRole: (role: Role, onDone?: Done) => void;
  deleteRole: (role: Role, onDone?: Done) => void;
  addCourse: (name: string, onDone?: Done) => void;
  renameCourse: (course: Course, name: string, onDone?: Done) => void;
  setCourseColor: (course: Course, color: string, onDone?: Done) => void;
  deleteCourse: (course: Course, onDone?: Done) => void;
  approveRequest: (request: JoinRequest) => void;
  rejectRequest: (request: JoinRequest) => void;
  saveLedgerSettings: (balanceVisibility: BalanceVisibility, paymentInfo: string, onDone?: Done) => void;
  addOpeningBalance: (member: Member, amountCentavos: number, note: string, onDone?: Done) => void;
  addRecord: (record: LedgerRecord, onDone?: Done) => void;
  addPayout: (charge: ChargeBatch | null, paidTo: string, dateMillis: number, onDone?: Done) => void;
  chargeStudents: (preview: ChargePreview, note: string, courseId: string, dateMillis: number, payNow: boolean, paidTo: string, onDone?: Done) => void;
  /** Voids a record: it stays in the list, crossed out, with the reason. */
  deleteRecord: (record: LedgerRecord, reason: string) => void;
  /** Voids a whole charge (its pay-out first when it was paid out). */
  undoCharge: (batch: ChargeBatch, reason: string) => void;
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

  // Keeps this member's last-name-first form in step with their profile, so lists can sort by last name.
  const myName = me.data?.name;
  const mySortName = me.data?.sortName ?? '';
  useEffect(() => {
    if (!myName) return;
    let stale = false;
    getDoc(doc(db, 'users', uid))
      .then((profile) => {
        const wanted = sortNameOf(profile.get('firstName') ?? '', profile.get('middleInitial') ?? '', profile.get('lastName') ?? '');
        if (!stale && wanted && wanted !== mySortName) return updateDoc(doc(classRepo.membersOf(classId), uid), { sortName: wanted });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [classId, uid, myName, mySortName]);
  const roles = useQueryList(`roles/${classId}/${allowed}`, allowed ? classRepo.rolesOf(classId) : null, (d) => fromDoc(newRole({}), d));
  const members = useQueryList(`members/${classId}/${allowed}`, allowed ? classRepo.membersOf(classId) : null, (d) => fromDoc(newMember({}), d));
  const courses = useQueryList(`courses/${classId}/${allowed}`, allowed ? classRepo.coursesOf(classId) : null, (d) => fromDoc<Course>({ id: '', name: '', color: '' }, d));
  const visible = useVisibleRecords(db, classId, uid);
  const records = useMemo(() => ({ data: allowed ? visible.data?.records : [], error: visible.error }), [allowed, visible]);
  const seeAll = visible.data?.scope === 'ALL';
  const myRoleEarly = roles.data?.find((r) => r.id === me.data?.roleId) ?? null;
  const manageRecords = allowed && roleCan(myRoleEarly, 'RECORDS_MANAGE');
  const summary = useFundSummary(db, classId, allowed);
  const charges = useCharges(db, classId, allowed);
  const joinRequests = useJoinRequests(db, classId, allowed && roleCan(myRoleEarly, 'MEMBERS_MANAGE'));
  const pendingOpenings = usePendingOpeningBalances(db, classId, manageRecords);
  useLedgerUpkeep(db, classId, uid, manageRecords);
  const contents = useQueryList(`contents/${classId}/${allowed}`, allowed ? dataRepo.contentsOf(classId) : null, (d) => fromDoc(newContentItem({}), d));
  const schedule = useQueryList(`schedule/${classId}/${allowed}`, allowed ? dataRepo.scheduleOf(classId) : null, (d) => fromDoc(newScheduleItem({}), d));
  const progress = useQueryList(`progress/${classId}/${allowed}`, allowed ? dataRepo.progressOf(classId) : null, (d) =>
    fromDoc<StudentProgress>({ id: '', done: {} }, d),
  );
  const classPhoto = useDocValue(`classPhoto/${classId}/${allowed}`, allowed ? doc(db, 'classPhotos', classId) : null, (d) =>
    typeof d.get('photo') === 'string' ? (d.get('photo') as string) : null,
  );
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
    // A student sees nothing of a course they do not take. Officers who manage a tab still see all of it.
    const skipped = new Set(meValue?.excludedCourseIds ?? []);
    const takes = (courseId: string | null | undefined) => !courseId || !skipped.has(courseId);
    const allContents = contents.data ?? [];
    const allSchedule = [...(schedule.data ?? [])].sort((a, b) => a.dueMillis - b.dueMillis);
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
      seeAll,
      summary: summary.data ?? null,
      charges: charges.data ?? [],
      joinRequests: joinRequests.data ?? [],
      pendingOpenings: pendingOpenings.data ?? [],
      contents: roleCan(myRole, 'CONTENTS_MANAGE') ? allContents : allContents.filter((i) => takes(i.courseId)),
      schedule: roleCan(myRole, 'SCHEDULE_MANAGE') ? allSchedule : allSchedule.filter((i) => takes(i.courseId)),
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
      takes,
    };
  }, [classId, uid, room, me, roles, members, courses, records, seeAll, summary, charges, joinRequests, pendingOpenings, contents, schedule, progress, avatars, classPhoto]);

  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

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
          const code = await classes.regenerateInviteCode(db, classId);
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
        const next: classes.ClassSettingsChanges = {
          name: updated.name.trim(),
          description: updated.description.trim(),
          accentColor: updated.accentColor,
          ledgerEnabled: updated.ledgerEnabled,
          scheduleEnabled: updated.scheduleEnabled,
          contentsEnabled: updated.contentsEnabled,
          announcementsEnabled: updated.announcementsEnabled,
          timetableEnabled: updated.timetableEnabled,
          scheduleIcons: ScheduleIcons.sanitize(updated.scheduleIcons),
          scheduleColors: ScheduleIcons.sanitizeColors(updated.scheduleColors),
          contentIcons: ContentIcons.sanitize(updated.contentIcons),
          contentColors: ContentIcons.sanitizeColors(updated.contentColors),
        };
        runAction('Class settings saved.', onDone, () => classes.updateClassSettings(db, classId, next));
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
        runAction(`${member.name}'s role was updated.`, onDone, () => membership.changeMemberRole(db, uid, classId, member.id, roleId));
      },

      setCoursesTaken(member, taken, onDone) {
        const c = st();
        if (!c.can('MEMBERS_MANAGE')) return deny('You do not have permission to change courses.');
        const excluded = c.courses.map((x) => x.id).filter((id) => !taken.has(id));
        runAction(`${member.name}'s courses were saved.`, onDone, () => membership.setMemberCourses(db, classId, member.id, excluded));
      },

      removeMember(member, onDone) {
        const c = st();
        if (!c.can('MEMBERS_MANAGE')) return deny('You do not have permission to remove members.');
        if (!MemberRules.canRemove(uid, member, c.room?.ownerUid ?? '')) return deny('This member cannot be removed.');
        runAction(`${member.name} was removed from the class.`, onDone, () => membership.removeMember(db, uid, classId, member.id));
      },

      leaveClass(newMayorUid, onDone) {
        const c = st();
        const handOver = MemberRules.mustHandOver(uid, c.room?.ownerUid ?? '');
        if (!handOver) return runAction(null, onDone, () => membership.leaveClass(db, uid, classId));
        if (!newMayorUid) return deny('Choose the new Mayor before you leave.');
        if (!MemberRules.mayorCandidates(uid, c.members).some((m) => m.id === newMayorUid)) return deny('Choose someone who is still in the class.');
        runAction(null, onDone, () => membership.handOverAndLeave(db, uid, classId, newMayorUid));
      },

      deleteClass(onDone) {
        const c = st();
        if (!c.room || c.room.ownerUid !== uid) return deny('Only the Mayor can delete the class.');
        if (!c.seeAll || !Ledger.canCloseBooks(c.records)) return deny('Everyone must be settled and the class fund must be empty before the class can be deleted.');
        runAction(`${c.room.name} was deleted.`, onDone, () => classes.deleteClass(db, uid, classId));
      },

      // ---- Roles ----

      saveRole(role, onDone) {
        const c = st();
        if (!c.can('ROLES_MANAGE')) return deny('You do not have permission to edit roles.');
        if (!RoleRules.canEdit(role)) return deny(`The ${role.name} role cannot be changed.`);
        if (!RoleRules.isNameValid(role.name, c.roles, role.id)) return deny('Use a role name of up to 24 characters that no other role uses.');
        runAction(`Role "${role.name.trim()}" saved.`, onDone, () => membership.saveRole(db, uid, classId, { ...role, name: role.name.trim() }, c.roles));
      },

      deleteRole(role, onDone) {
        const c = st();
        const defaultRoleId = c.room?.defaultRoleId ?? '';
        if (!c.can('ROLES_MANAGE')) return deny('You do not have permission to delete roles.');
        if (!RoleRules.canDelete(role, defaultRoleId)) return deny(`The ${role.name} role cannot be deleted.`);
        runAction(`Role "${role.name}" deleted.`, onDone, () => membership.deleteRole(db, classId, role.id));
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

      setCourseColor(course, color, onDone) {
        if (!st().can('CLASS_SETTINGS')) return deny('You do not have permission to edit courses.');
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return deny('Choose one of the colors.');
        runAction(`Color of ${course.name} changed.`, onDone, () => classRepo.setCourseColor(classId, course.id, color));
      },

      deleteCourse(course, onDone) {
        if (!st().can('CLASS_SETTINGS')) return deny('You do not have permission to edit courses.');
        runAction(`Deleted ${course.name}.`, onDone, () => classRepo.deleteCourse(classId, course.id));
      },

      // ---- Joining ----

      approveRequest(request) {
        if (!st().can('MEMBERS_MANAGE')) return deny('You do not have permission to approve requests.');
        runAction(`${request.name} is now in the class.`, undefined, () => membership.approveJoinRequest(db, uid, classId, request.uid));
      },

      rejectRequest(request) {
        if (!st().can('MEMBERS_MANAGE')) return deny('You do not have permission to reject requests.');
        runAction(`The request of ${request.name} was rejected.`, undefined, () => membership.rejectJoinRequest(db, classId, request.uid));
      },

      // ---- Ledger ----

      saveLedgerSettings(balanceVisibility, paymentInfo, onDone) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to change the ledger settings.');
        runAction('Ledger settings saved.', onDone, () => classes.updateLedgerSettings(db, classId, { balanceVisibility, paymentInfo: paymentInfo.trim() }));
      },

      addOpeningBalance(member, amountCentavos, note, onDone) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to add ledger records.');
        if (!amountCentavos) return deny('Enter an opening balance that is not zero.');
        runAction(`Opening balance of ${formatMoney(amountCentavos)} for ${member.name} saved.`, onDone, () =>
          openings.addOpeningBalance(db, uid, classId, { memberId: member.id, memberName: member.name, amountCentavos, note }),
        );
      },

      addRecord(record, onDone) {
        const c = st();
        if (!c.can('RECORDS_MANAGE')) return deny('You do not have permission to add ledger records.');
        const error = LedgerForms.checkRecord(
          record.type,
          record.amountCentavos > 0 ? record.amountCentavos : null,
          record.memberId,
        );
        if (error) return deny(error);
        const label =
          record.type === 'WITHDRAWAL'
            ? `Withdrawal of ${formatMoney(record.amountCentavos)} by ${record.memberName} saved.`
            : `Payment of ${formatMoney(record.amountCentavos)} from ${record.memberName} saved.`;
        const input = { memberId: record.memberId, memberName: record.memberName, amountCentavos: record.amountCentavos, dateMillis: record.dateMillis, note: record.note };
        runAction(label, onDone, () => (record.type === 'WITHDRAWAL' ? ledgerStore.addWithdrawal(db, uid, classId, input) : ledgerStore.addPayment(db, uid, classId, input)));
      },

      addPayout(charge, paidTo, dateMillis, onDone) {
        const c = st();
        if (!c.can('RECORDS_MANAGE')) return deny('You do not have permission to record pay-outs.');
        const alreadyPaid = !!charge && Ledger.paidOutBatchIds(c.records).has(charge.batchId);
        const problem = LedgerForms.checkPayout(charge, alreadyPaid);
        if (problem || !charge) return deny(problem ?? 'Choose the charge this pay-out is for.');
        const batchId = charge.batchId;
        runAction(`Paid out ${formatMoney(charge.totalCentavos)} for "${charge.note}".`, onDone, () => ledgerStore.payOutCharge(db, uid, classId, batchId, { paidTo, dateMillis }));
      },

      chargeStudents(preview, note, courseId, dateMillis, payNow, paidTo, onDone) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to charge students.');
        const problem = LedgerForms.checkCharge(preview.perMemberCentavos > 0 ? preview.perMemberCentavos : null, note, preview.charged.length);
        if (problem) return deny(problem);
        const shares = preview.charged.map((m) => ({ memberId: m.id, memberName: m.name, amountCentavos: preview.perMemberCentavos }));
        const n = preview.charged.length;
        const message =
          `Charged ${n} student${s(n)} ${formatMoney(preview.perMemberCentavos)} each (${formatMoney(preview.totalCentavos)} in total)` +
          (payNow ? ' and recorded the pay-out.' : '.');
        runAction(message, onDone, () =>
          ledgerStore.chargeStudents(db, uid, classId, { note: note.trim(), courseId, dateMillis, shares, payout: payNow ? { paidTo } : undefined }),
        );
      },

      deleteRecord(record, reason) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to void ledger records.');
        if (record.type === 'CHARGE' && record.batchId) return deny('This is part of a charge to several students. Void the whole charge instead.');
        const message = record.type === 'EXPENSE' ? 'Pay-out voided. Its charge is waiting to be paid out again.' : 'Record voided.';
        runAction(message, undefined, () => ledgerStore.voidRecord(db, uid, classId, record.id, reason));
      },

      undoCharge(batch, reason) {
        if (!st().can('RECORDS_MANAGE')) return deny('You do not have permission to void charges.');
        runAction(`Charge "${batch.note}" voided for ${batch.count} student${s(batch.count)}.`, undefined, () =>
          ledgerStore.voidCharge(db, uid, classId, batch.batchId, reason, { voidPayoutFirst: true }),
        );
      },

      // ---- Schedule ----

      saveScheduleItem(item, onDone) {
        if (!st().can('SCHEDULE_MANAGE')) return deny('You do not have permission to manage the schedule.');
        const problem = ScheduleForms.check(item.title);
        if (problem) return deny(problem);
        const clean = { ...item, title: item.title.trim(), note: item.note.trim() };
        if (!clean.id) {
          runAction(`Added "${clean.title}".`, onDone, async () => {
            await dataRepo.addScheduleItem(classId, { ...clean, createdByUid: uid });
            const due = new Date(clean.dueMillis).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            void queueNotice(db, uid, classId, { kind: 'SCHEDULE_NEW', audience: clean.courseId ? 'COURSE' : 'CLASS', audienceId: clean.courseId, title: `New on the schedule: ${clean.title}`, body: `Due ${due}` });
          });
        }
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
        // A class that was deleted can leave this user's entry behind; removing it clears it from My classes.
        if (stateRef.current.room === null && stateRef.current.me) membership.leaveClass(db, uid, classId).catch(() => {});
      },
    };
  }, [busy, classId, uid, notice, runAction]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <ClassContext.Provider value={value}>{children}</ClassContext.Provider>;
}

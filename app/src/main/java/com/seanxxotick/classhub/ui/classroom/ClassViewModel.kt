package com.seanxxotick.classhub.ui.classroom

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.model.ClassRoom
import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.Course
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleStatus
import com.seanxxotick.classhub.data.repository.ContentRepository
import com.seanxxotick.classhub.data.model.StudentProgress
import com.seanxxotick.classhub.data.repository.ProgressRepository
import com.seanxxotick.classhub.data.repository.ScheduleRepository
import com.seanxxotick.classhub.domain.ContentRules
import com.seanxxotick.classhub.domain.ScheduleForms
import com.seanxxotick.classhub.domain.ScheduleLogic
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.RecordType
import com.seanxxotick.classhub.data.model.Role
import com.seanxxotick.classhub.data.repository.ClassRepository
import com.seanxxotick.classhub.data.repository.CourseRepository
import com.seanxxotick.classhub.data.repository.LedgerRepository
import com.seanxxotick.classhub.data.repository.MemberRepository
import com.seanxxotick.classhub.data.repository.RoleRepository
import com.seanxxotick.classhub.domain.ChargePlanner
import com.seanxxotick.classhub.domain.ChargePreview
import com.seanxxotick.classhub.domain.CourseRules
import com.seanxxotick.classhub.domain.Ledger
import com.seanxxotick.classhub.domain.LedgerEntry
import com.seanxxotick.classhub.domain.LedgerForms
import com.seanxxotick.classhub.domain.MemberRules
import com.seanxxotick.classhub.domain.Money
import com.seanxxotick.classhub.domain.RoleRules
import com.seanxxotick.classhub.domain.can
import com.seanxxotick.classhub.ui.common.friendlyMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

data class ClassUiState(
    val loading: Boolean = true,
    val room: ClassRoom? = null,
    val me: Member? = null,
    val roles: List<Role> = emptyList(),
    val members: List<Member> = emptyList(),
    val courses: List<Course> = emptyList(),
    val records: List<LedgerRecord> = emptyList(),
    val contents: List<ContentItem> = emptyList(),
    val schedule: List<ScheduleItem> = emptyList(),
    /** Schedule items the signed-in student marked done. */
    val myDone: Set<String> = emptySet(),
    val error: String? = null,
) {
    /** Current balance of every member, in centavos. */
    val balances: Map<String, Long> by lazy { Ledger.memberBalances(members, records) }

    fun balanceOf(memberId: String): Long = balances[memberId] ?: 0L

    /** The class is gone, or this user is no longer in it. */
    val removed: Boolean get() = !loading && error == null && (room == null || me == null)

    val myRole: Role? get() = roleOf(me)

    fun roleOf(member: Member?): Role? = member?.let { m -> roles.firstOrNull { it.id == m.roleId } }

    fun can(permission: Permission): Boolean = myRole.can(permission)
}

/**
 * Everything the class screens need, kept live from Firestore, plus the officer actions.
 * One instance is shared by the class screen and its management screens.
 */
class ClassViewModel(
    private val classId: String,
    private val uid: String,
    private val classRepo: ClassRepository = ClassRepository(),
    private val memberRepo: MemberRepository = MemberRepository(classId),
    private val roleRepo: RoleRepository = RoleRepository(classId),
    private val courseRepo: CourseRepository = CourseRepository(classId),
    private val ledgerRepo: LedgerRepository = LedgerRepository(classId),
    private val contentRepo: ContentRepository = ContentRepository(classId),
    private val scheduleRepo: ScheduleRepository = ScheduleRepository(classId),
    private val progressRepo: ProgressRepository = ProgressRepository(classId),
) : ViewModel() {
    val state: StateFlow<ClassUiState> = combine(
        combine(
            classRepo.observeClass(classId),
            memberRepo.observeMember(uid),
            roleRepo.observeRoles(),
            memberRepo.observeMembers(),
            courseRepo.observeCourses(),
        ) { room, me, roles, members, courses ->
            ClassUiState(loading = false, room = room, me = me, roles = roles, members = members, courses = courses)
        },
        ledgerRepo.observeRecords(),
        contentRepo.observeContents(),
        scheduleRepo.observeItems(),
        progressRepo.observeMine(uid),
    ) { base, records, contents, schedule, myDone ->
        base.copy(records = records, contents = contents, schedule = schedule, myDone = myDone)
    }
        .catch { emit(ClassUiState(loading = false, error = friendlyMessage(it))) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ClassUiState())

    /**
     * Every student's done marks, loaded only while the signed-in user may manage the schedule,
     * since students do not see each other's progress.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val allProgress: StateFlow<List<StudentProgress>> = state
        .map { it.can(Permission.SCHEDULE_MANAGE) }
        .distinctUntilChanged()
        .flatMapLatest { allowed ->
            if (allowed) progressRepo.observeAll().catch { emit(emptyList()) } else flowOf(emptyList())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _notice = MutableStateFlow<String?>(null)
    /** One-off messages such as "Role saved" or an error from an action. */
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun regenerateInviteCode() {
        val room = state.value.room ?: return
        runAction(success = null) {
            val code = classRepo.regenerateInviteCode(room)
            _notice.value = "New invite code: $code. The old code no longer works."
        }
    }

    // ---- Members ----

    fun setRole(member: Member, roleId: String, onDone: () -> Unit = {}) {
        val s = state.value
        val ownerUid = s.room?.ownerUid.orEmpty()
        when {
            !s.can(Permission.MEMBERS_MANAGE) -> _notice.value = "You do not have permission to change roles."
            !MemberRules.canChangeRole(uid, member, ownerUid) -> _notice.value = "This member's role cannot be changed."
            MemberRules.assignableRoles(s.roles).none { it.id == roleId } -> _notice.value = "Pick one of the class's roles."
            else -> runAction("${member.name}'s role was updated.", onDone) { memberRepo.setRole(member.id, roleId) }
        }
    }

    /** [takenCourseIds] are the courses the member takes; everything else is stored as excluded. */
    fun setCoursesTaken(member: Member, takenCourseIds: Set<String>, onDone: () -> Unit = {}) {
        val s = state.value
        if (!s.can(Permission.MEMBERS_MANAGE)) {
            _notice.value = "You do not have permission to change courses."
            return
        }
        val excluded = s.courses.map { it.id }.filterNot { it in takenCourseIds }
        runAction("${member.name}'s courses were saved.", onDone) { memberRepo.setExcludedCourses(member.id, excluded) }
    }

    fun removeMember(member: Member, onDone: () -> Unit = {}) {
        val s = state.value
        when {
            !s.can(Permission.MEMBERS_MANAGE) -> _notice.value = "You do not have permission to remove members."
            !MemberRules.canRemove(uid, member, s.room?.ownerUid.orEmpty()) -> _notice.value = "This member cannot be removed."
            else -> runAction("${member.name} was removed from the class.", onDone) { memberRepo.remove(member.id) }
        }
    }

    // ---- Roles ----

    fun saveRole(role: Role, onDone: () -> Unit = {}) {
        val s = state.value
        when {
            !s.can(Permission.ROLES_MANAGE) -> _notice.value = "You do not have permission to edit roles."
            !RoleRules.canEdit(role) -> _notice.value = "The ${role.name} role cannot be changed."
            !RoleRules.isNameValid(role.name, s.roles, role.id) ->
                _notice.value = "Use a role name of up to 24 characters that no other role uses."
            else -> runAction("Role \"${role.name.trim()}\" saved.", onDone) {
                roleRepo.save(role.copy(name = role.name.trim()))
            }
        }
    }

    fun deleteRole(role: Role, onDone: () -> Unit = {}) {
        val s = state.value
        val defaultRoleId = s.room?.defaultRoleId.orEmpty()
        when {
            !s.can(Permission.ROLES_MANAGE) -> _notice.value = "You do not have permission to delete roles."
            !RoleRules.canDelete(role, defaultRoleId) -> _notice.value = "The ${role.name} role cannot be deleted."
            else -> runAction("Role \"${role.name}\" deleted.", onDone) { roleRepo.delete(role, defaultRoleId) }
        }
    }

    // ---- Courses ----

    fun addCourse(name: String, onDone: () -> Unit = {}) {
        val s = state.value
        when {
            !s.can(Permission.CLASS_SETTINGS) -> _notice.value = "You do not have permission to edit courses."
            !CourseRules.isNameValid(name, s.courses) ->
                _notice.value = "Use a course name of up to ${CourseRules.MAX_NAME} characters that is not already listed."
            else -> runAction("Added ${name.trim()}.", onDone) { courseRepo.add(name) }
        }
    }

    fun renameCourse(course: Course, name: String, onDone: () -> Unit = {}) {
        val s = state.value
        when {
            !s.can(Permission.CLASS_SETTINGS) -> _notice.value = "You do not have permission to edit courses."
            !CourseRules.isNameValid(name, s.courses, course.id) ->
                _notice.value = "Use a course name of up to ${CourseRules.MAX_NAME} characters that is not already listed."
            else -> runAction("Renamed to ${name.trim()}.", onDone) { courseRepo.rename(course.id, name) }
        }
    }

    fun deleteCourse(course: Course, onDone: () -> Unit = {}) {
        if (!state.value.can(Permission.CLASS_SETTINGS)) {
            _notice.value = "You do not have permission to edit courses."
            return
        }
        runAction("Deleted ${course.name}.", onDone) { courseRepo.delete(course.id) }
    }

    // ---- Ledger ----

    /** Payment or Withdrawal. Re-checks the form against the live balance before saving. */
    fun addRecord(record: LedgerRecord, onDone: () -> Unit = {}) {
        val s = state.value
        if (!s.can(Permission.RECORDS_MANAGE)) {
            _notice.value = "You do not have permission to add ledger records."
            return
        }
        val error = LedgerForms.checkRecord(
            type = record.type,
            amountCentavos = record.amountCentavos.takeIf { it > 0 },
            memberId = record.memberId,
            memberBalanceCentavos = record.memberId.takeIf { it.isNotEmpty() }?.let { s.balanceOf(it) },
        )
        if (error != null) {
            _notice.value = error
            return
        }
        val label = when (record.type) {
            RecordType.WITHDRAWAL -> "Withdrawal of ${Money.format(record.amountCentavos)} by ${record.memberName} saved."
            else -> "Payment of ${Money.format(record.amountCentavos)} from ${record.memberName} saved."
        }
        runAction(label, onDone) { ledgerRepo.add(record.copy(createdByUid = uid)) }
    }

    /** Pays out a charge in full. The amount is always the charge's total. */
    fun addPayout(charge: LedgerEntry.ChargeBatch?, paidTo: String, dateMillis: Long, onDone: () -> Unit = {}) {
        val s = state.value
        if (!s.can(Permission.RECORDS_MANAGE)) {
            _notice.value = "You do not have permission to record pay-outs."
            return
        }
        val alreadyPaid = charge != null && charge.batchId in Ledger.paidOutBatchIds(s.records)
        LedgerForms.checkPayout(charge, alreadyPaid)?.let {
            _notice.value = it
            return
        }
        val c = charge ?: return
        val payout = ChargePlanner.buildPayout(c.batchId, c.totalCentavos, c.note, dateMillis, paidTo).copy(createdByUid = uid)
        runAction("Paid out ${Money.format(c.totalCentavos)} for \"${c.note}\".", onDone) { ledgerRepo.add(payout) }
    }

    /**
     * Charges every member in [preview] the same amount, as one undoable batch.
     * With [payNow], the pay-out for the full total is saved in the same batch.
     */
    fun chargeStudents(
        preview: ChargePreview,
        note: String,
        courseId: String,
        dateMillis: Long,
        payNow: Boolean,
        paidTo: String,
        onDone: () -> Unit = {},
    ) {
        if (!state.value.can(Permission.RECORDS_MANAGE)) {
            _notice.value = "You do not have permission to charge students."
            return
        }
        val error = LedgerForms.checkCharge(preview.perMemberCentavos.takeIf { it > 0 }, note, preview.charged.size)
        if (error != null) {
            _notice.value = error
            return
        }
        val batchId = UUID.randomUUID().toString()
        val charges = ChargePlanner.buildRecords(preview, note.trim(), courseId, dateMillis, batchId)
        val payout = if (payNow) listOf(ChargePlanner.buildPayout(batchId, preview.totalCentavos, note.trim(), dateMillis, paidTo)) else emptyList()
        val records = (charges + payout).map { it.copy(createdByUid = uid) }
        val message = "Charged ${preview.charged.size} student${if (preview.charged.size == 1) "" else "s"} " +
            "${Money.format(preview.perMemberCentavos)} each (${Money.format(preview.totalCentavos)} in total)" +
            if (payNow) " and recorded the pay-out." else "."
        runAction(message, onDone) { ledgerRepo.addAll(records) }
    }

    fun deleteRecord(record: LedgerRecord) {
        if (!state.value.can(Permission.RECORDS_MANAGE)) {
            _notice.value = "You do not have permission to delete ledger records."
            return
        }
        if (record.type == RecordType.CHARGE && record.batchId.isNotEmpty()) {
            _notice.value = "This is part of a charge to several students. Use Undo charge on the charge instead."
            return
        }
        val message = if (record.type == RecordType.EXPENSE) "Pay-out deleted. Its charge is waiting to be paid out again." else "Record deleted."
        runAction(message) { ledgerRepo.delete(record.id) }
    }

    fun undoCharge(batch: LedgerEntry.ChargeBatch) {
        if (!state.value.can(Permission.RECORDS_MANAGE)) {
            _notice.value = "You do not have permission to undo charges."
            return
        }
        if (batch.batchId in Ledger.paidOutBatchIds(state.value.records)) {
            _notice.value = "This charge has already been paid out. Delete its pay-out first, then undo the charge."
            return
        }
        runAction("Charge \"${batch.note}\" undone for ${batch.count} student${if (batch.count == 1) "" else "s"}.") {
            ledgerRepo.deleteBatch(batch.batchId)
        }
    }

    // ---- Schedule ----

    /** Adds a new item (blank id) or saves changes to an existing one. */
    fun saveScheduleItem(item: ScheduleItem, onDone: () -> Unit = {}) {
        if (!state.value.can(Permission.SCHEDULE_MANAGE)) {
            _notice.value = "You do not have permission to manage the schedule."
            return
        }
        ScheduleForms.check(item.title)?.let {
            _notice.value = it
            return
        }
        val clean = item.copy(title = item.title.trim(), note = item.note.trim())
        if (clean.id.isEmpty()) {
            runAction("Added \"${clean.title}\".", onDone) { scheduleRepo.add(clean.copy(createdByUid = uid)) }
        } else {
            runAction("Saved \"${clean.title}\".", onDone) { scheduleRepo.update(clean) }
        }
    }

    /** Cancels an item for the whole class (for example a quiz that was called off), or restores it. */
    fun setCancelled(item: ScheduleItem, cancelled: Boolean) {
        if (!state.value.can(Permission.SCHEDULE_MANAGE)) {
            _notice.value = "You do not have permission to manage the schedule."
            return
        }
        val status = if (cancelled) ScheduleStatus.CANCELLED else ScheduleStatus.PENDING
        val message = if (cancelled) "\"${item.title}\" is cancelled for the class." else "\"${item.title}\" is active again."
        runAction(message) { scheduleRepo.setStatus(item.id, status) }
    }

    /** Any member marks an item done or not done for themselves only. */
    fun setDone(item: ScheduleItem, done: Boolean) {
        if (ScheduleLogic.isCancelled(item)) {
            _notice.value = "This item was cancelled, so there is nothing to mark."
            return
        }
        val message = if (done) "Marked \"${item.title}\" as done." else "Marked \"${item.title}\" as not done."
        runAction(message) {
            if (done) progressRepo.markDone(uid, item.id) else progressRepo.markNotDone(uid, item.id)
        }
    }

    fun deleteScheduleItem(item: ScheduleItem, onDone: () -> Unit = {}) {
        if (!state.value.can(Permission.SCHEDULE_MANAGE)) {
            _notice.value = "You do not have permission to manage the schedule."
            return
        }
        runAction("Deleted \"${item.title}\".", onDone) { scheduleRepo.delete(item.id) }
    }

    // ---- Class contents ----

    /** Adds a new item (blank id) or saves changes to an existing one. */
    fun saveContent(item: ContentItem, onDone: () -> Unit = {}) {
        if (!state.value.can(Permission.CONTENTS_MANAGE)) {
            _notice.value = "You do not have permission to manage class contents."
            return
        }
        ContentRules.check(item.title, item.url)?.let {
            _notice.value = it
            return
        }
        val clean = item.copy(title = item.title.trim(), url = ContentRules.normalizeUrl(item.url), note = item.note.trim())
        if (clean.id.isEmpty()) {
            runAction("Added \"${clean.title}\".", onDone) {
                contentRepo.add(clean.copy(createdByUid = uid, createdAtMillis = System.currentTimeMillis()))
            }
        } else {
            runAction("Saved \"${clean.title}\".", onDone) { contentRepo.update(clean) }
        }
    }

    fun deleteContent(item: ContentItem, onDone: () -> Unit = {}) {
        if (!state.value.can(Permission.CONTENTS_MANAGE)) {
            _notice.value = "You do not have permission to manage class contents."
            return
        }
        runAction("Deleted \"${item.title}\".", onDone) { contentRepo.delete(item.id) }
    }

    /** Lets screens show a message, for example when a link cannot be opened. */
    fun showNotice(message: String) {
        _notice.value = message
    }

    /** Drops this class from "My classes" after the user was removed or the class was deleted. */
    fun forgetClass() {
        viewModelScope.launch { runCatching { classRepo.forgetMembership(uid, classId) } }
    }

    fun clearNotice() {
        _notice.value = null
    }

    private fun runAction(success: String?, onDone: () -> Unit = {}, block: suspend () -> Unit) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            try {
                block()
                if (success != null) _notice.value = success
                onDone()
            } catch (e: Exception) {
                _notice.value = friendlyMessage(e)
            } finally {
                _busy.value = false
            }
        }
    }
}

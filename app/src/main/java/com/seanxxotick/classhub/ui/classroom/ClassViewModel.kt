package com.seanxxotick.classhub.ui.classroom

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.model.ClassRoom
import com.seanxxotick.classhub.data.model.Course
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.Role
import com.seanxxotick.classhub.data.repository.ClassRepository
import com.seanxxotick.classhub.data.repository.CourseRepository
import com.seanxxotick.classhub.data.repository.MemberRepository
import com.seanxxotick.classhub.data.repository.RoleRepository
import com.seanxxotick.classhub.domain.CourseRules
import com.seanxxotick.classhub.domain.MemberRules
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

data class ClassUiState(
    val loading: Boolean = true,
    val room: ClassRoom? = null,
    val me: Member? = null,
    val roles: List<Role> = emptyList(),
    val members: List<Member> = emptyList(),
    val courses: List<Course> = emptyList(),
    val error: String? = null,
) {
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
) : ViewModel() {
    val state: StateFlow<ClassUiState> = combine(
        classRepo.observeClass(classId),
        memberRepo.observeMember(uid),
        roleRepo.observeRoles(),
        memberRepo.observeMembers(),
        courseRepo.observeCourses(),
    ) { room, me, roles, members, courses ->
        ClassUiState(loading = false, room = room, me = me, roles = roles, members = members, courses = courses)
    }
        .catch { emit(ClassUiState(loading = false, error = friendlyMessage(it))) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ClassUiState())

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

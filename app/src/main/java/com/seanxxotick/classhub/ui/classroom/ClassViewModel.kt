package com.seanxxotick.classhub.ui.classroom

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.model.ClassRoom
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.Role
import com.seanxxotick.classhub.data.repository.ClassRepository
import com.seanxxotick.classhub.data.repository.MemberRepository
import com.seanxxotick.classhub.data.repository.RoleRepository
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
    val error: String? = null,
) {
    /** The class is gone, or this user is no longer in it. */
    val removed: Boolean get() = !loading && error == null && (room == null || me == null)

    val myRole: Role? get() = roleOf(me)

    fun roleOf(member: Member?): Role? = member?.let { m -> roles.firstOrNull { it.id == m.roleId } }

    fun can(permission: Permission): Boolean = myRole.can(permission)
}

/** Everything one class screen needs, kept live from Firestore. */
class ClassViewModel(
    private val classId: String,
    private val uid: String,
    private val classRepo: ClassRepository = ClassRepository(),
    memberRepo: MemberRepository = MemberRepository(classId),
    roleRepo: RoleRepository = RoleRepository(classId),
) : ViewModel() {
    val state: StateFlow<ClassUiState> = combine(
        classRepo.observeClass(classId),
        memberRepo.observeMember(uid),
        roleRepo.observeRoles(),
        memberRepo.observeMembers(),
    ) { room, me, roles, members ->
        ClassUiState(loading = false, room = room, me = me, roles = roles, members = members)
    }
        .catch { emit(ClassUiState(loading = false, error = friendlyMessage(it))) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ClassUiState())

    private val _notice = MutableStateFlow<String?>(null)
    /** One-off messages such as "New code created" or an error from an action. */
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun regenerateInviteCode() {
        val room = state.value.room ?: return
        viewModelScope.launch {
            _busy.value = true
            _notice.value = try {
                val code = classRepo.regenerateInviteCode(room)
                "New invite code: $code. The old code no longer works."
            } catch (e: Exception) {
                friendlyMessage(e)
            }
            _busy.value = false
        }
    }

    /** Drops this class from "My classes" after the user was removed or the class was deleted. */
    fun forgetClass() {
        viewModelScope.launch { runCatching { classRepo.forgetMembership(uid, classId) } }
    }

    fun clearNotice() {
        _notice.value = null
    }
}

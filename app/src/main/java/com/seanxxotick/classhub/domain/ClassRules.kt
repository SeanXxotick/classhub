package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Course
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Role

object ClassRules {
    const val MAX_NAME = 40
    const val MAX_DESCRIPTION = 80

    /** Returns an error message, or null when the class name can be saved. */
    fun checkName(name: String): String? = when {
        name.isBlank() -> "Give the class a name."
        name.trim().length > MAX_NAME -> "Keep the class name under $MAX_NAME characters."
        else -> null
    }
}

object MemberRules {
    /**
     * The class owner (Mayor) can't be given another role, and nobody changes their own role,
     * so an officer can't promote themselves.
     */
    fun canChangeRole(actorUid: String, target: Member, ownerUid: String): Boolean =
        target.id != ownerUid && target.id != actorUid

    /** The owner can't be removed, and members aren't removed by themselves from this screen. */
    fun canRemove(actorUid: String, target: Member, ownerUid: String): Boolean =
        target.id != ownerUid && target.id != actorUid

    /** The locked Mayor role belongs to the owner only, so it is never offered when assigning roles. */
    fun assignableRoles(roles: List<Role>): List<Role> = roles.filterNot { it.locked }

    /** How many members currently hold [role]. */
    fun holders(role: Role, members: List<Member>): Int = members.count { it.roleId == role.id }
}

object CourseRules {
    const val MAX_NAME = 40

    /** A course name must be non-blank, short enough, and not already used (ignoring case). */
    fun isNameValid(name: String, existing: List<Course>, editingId: String = ""): Boolean {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || trimmed.length > MAX_NAME) return false
        return existing.none { it.id != editingId && it.name.equals(trimmed, ignoreCase = true) }
    }

    /** How many members take [course], i.e. don't exclude it. */
    fun takers(course: Course, members: List<Member>): Int = members.count { course.id !in it.excludedCourseIds }
}

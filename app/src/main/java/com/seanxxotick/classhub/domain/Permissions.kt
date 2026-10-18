package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.ROLE_MAYOR
import com.seanxxotick.classhub.data.model.ROLE_MEMBER
import com.seanxxotick.classhub.data.model.ROLE_SECRETARY
import com.seanxxotick.classhub.data.model.ROLE_TREASURER
import com.seanxxotick.classhub.data.model.Role

/** True when this role grants [permission]. A missing role (not a member) grants nothing. */
fun Role?.can(permission: Permission): Boolean = this != null && permission.name in permissions

/** The roles every new class starts with. The Mayor can add, change and delete the others. */
object DefaultRoles {
    fun all(): List<Role> = listOf(
        Role(
            id = ROLE_MAYOR,
            name = "Mayor",
            colorHex = "#7C3AED",
            permissions = Permission.entries.map { it.name },
            locked = true,
        ),
        Role(
            id = ROLE_TREASURER,
            name = "Treasurer",
            colorHex = "#15803D",
            permissions = listOf(Permission.RECORDS_MANAGE.name),
        ),
        Role(
            id = ROLE_SECRETARY,
            name = "Secretary",
            colorHex = "#3730A3",
            permissions = listOf(Permission.SCHEDULE_MANAGE.name),
        ),
        Role(
            id = ROLE_MEMBER,
            name = "Member",
            colorHex = "#6B768A",
            permissions = emptyList(),
        ),
    )
}

object RoleRules {
    /** Locked roles (the Mayor) cannot be edited. */
    fun canEdit(role: Role): Boolean = !role.locked

    /** Locked roles and the class's default role cannot be deleted, since new members land in the default role. */
    fun canDelete(role: Role, defaultRoleId: String): Boolean = !role.locked && role.id != defaultRoleId

    /** A role name must be non-blank and not already used by another role (ignoring case). */
    fun isNameValid(name: String, existing: List<Role>, editingId: String = ""): Boolean {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || trimmed.length > 24) return false
        return existing.none { it.id != editingId && it.name.equals(trimmed, ignoreCase = true) }
    }

    /** Only known permission names are kept, and duplicates are dropped. */
    fun sanitize(permissions: Collection<String>): List<String> {
        val known = Permission.entries.map { it.name }.toSet()
        return permissions.filter { it in known }.distinct()
    }
}

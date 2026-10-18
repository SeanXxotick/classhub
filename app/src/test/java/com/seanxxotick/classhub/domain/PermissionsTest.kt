package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.ROLE_MAYOR
import com.seanxxotick.classhub.data.model.ROLE_MEMBER
import com.seanxxotick.classhub.data.model.ROLE_SECRETARY
import com.seanxxotick.classhub.data.model.ROLE_TREASURER
import com.seanxxotick.classhub.data.model.Role
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PermissionsTest {
    private val roles = DefaultRoles.all().associateBy { it.id }

    @Test
    fun defaultRoles_haveTheExpectedIds_andAreUnique() {
        val ids = DefaultRoles.all().map { it.id }
        assertEquals(setOf(ROLE_MAYOR, ROLE_TREASURER, ROLE_SECRETARY, ROLE_MEMBER), ids.toSet())
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun mayor_hasEveryPermission_andIsLocked() {
        val mayor = roles.getValue(ROLE_MAYOR)
        Permission.entries.forEach { assertTrue("Mayor should have $it", mayor.can(it)) }
        assertTrue(mayor.locked)
    }

    @Test
    fun treasurer_canManageRecords_butNothingElse() {
        val treasurer = roles.getValue(ROLE_TREASURER)
        assertTrue(treasurer.can(Permission.RECORDS_MANAGE))
        Permission.entries.filter { it != Permission.RECORDS_MANAGE }.forEach {
            assertFalse("Treasurer should not have $it", treasurer.can(it))
        }
    }

    @Test
    fun secretary_canManageSchedule_butNothingElse() {
        val secretary = roles.getValue(ROLE_SECRETARY)
        assertTrue(secretary.can(Permission.SCHEDULE_MANAGE))
        assertFalse(secretary.can(Permission.RECORDS_MANAGE))
        assertFalse(secretary.can(Permission.MEMBERS_MANAGE))
    }

    @Test
    fun mayorRoleSavedBeforeANewPermissionExisted_stillHasIt() {
        val oldMayor = Role(id = ROLE_MAYOR, name = "Mayor", permissions = listOf("RECORDS_MANAGE"), locked = true)
        assertTrue(oldMayor.can(Permission.CONTENTS_MANAGE))
    }

    @Test
    fun secretary_canManageClassContents() {
        assertTrue(roles.getValue(ROLE_SECRETARY).can(Permission.CONTENTS_MANAGE))
    }

    @Test
    fun member_canDoNothing() {
        Permission.entries.forEach { assertFalse(roles.getValue(ROLE_MEMBER).can(it)) }
    }

    @Test
    fun missingRole_grantsNothing() {
        val nobody: Role? = null
        Permission.entries.forEach { assertFalse(nobody.can(it)) }
    }

    @Test
    fun onlyTheMayorRoleIsLocked() {
        assertEquals(listOf(ROLE_MAYOR), DefaultRoles.all().filter { it.locked }.map { it.id })
    }

    @Test
    fun lockedRole_cannotBeEditedOrDeleted() {
        val mayor = roles.getValue(ROLE_MAYOR)
        assertFalse(RoleRules.canEdit(mayor))
        assertFalse(RoleRules.canDelete(mayor, ROLE_MEMBER))
    }

    @Test
    fun defaultRole_cannotBeDeleted_butOtherRolesCan() {
        assertFalse(RoleRules.canDelete(roles.getValue(ROLE_MEMBER), ROLE_MEMBER))
        assertTrue(RoleRules.canDelete(roles.getValue(ROLE_TREASURER), ROLE_MEMBER))
        assertTrue(RoleRules.canEdit(roles.getValue(ROLE_TREASURER)))
    }

    @Test
    fun roleName_mustBeNonBlank_shortEnough_andUnique() {
        val existing = DefaultRoles.all()
        assertFalse(RoleRules.isNameValid("   ", existing))
        assertFalse(RoleRules.isNameValid("x".repeat(25), existing))
        assertFalse(RoleRules.isNameValid("treasurer", existing))
        assertTrue(RoleRules.isNameValid("PIO", existing))
    }

    @Test
    fun roleName_canKeepItsOwnName_whenEditing() {
        val existing = DefaultRoles.all()
        assertTrue(RoleRules.isNameValid("Treasurer", existing, editingId = ROLE_TREASURER))
        assertFalse(RoleRules.isNameValid("Secretary", existing, editingId = ROLE_TREASURER))
    }

    @Test
    fun sanitize_dropsUnknownAndDuplicatePermissions() {
        val cleaned = RoleRules.sanitize(listOf("RECORDS_MANAGE", "FLY_THE_PLANE", "RECORDS_MANAGE", "ROLES_MANAGE"))
        assertEquals(listOf("RECORDS_MANAGE", "ROLES_MANAGE"), cleaned)
    }
}

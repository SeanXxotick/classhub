package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Course
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.ROLE_MAYOR
import com.seanxxotick.classhub.data.model.ROLE_MEMBER
import com.seanxxotick.classhub.data.model.ROLE_TREASURER
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassRulesTest {
    private val owner = Member(id = "owner", name = "Juan", roleId = ROLE_MAYOR)
    private val officer = Member(id = "officer", name = "Maria", roleId = ROLE_TREASURER)
    private val student = Member(id = "student", name = "Lito", roleId = ROLE_MEMBER, excludedCourseIds = listOf("or"))

    @Test
    fun ownersRole_cannotBeChanged_byAnyone() {
        assertFalse(MemberRules.canChangeRole(actorUid = "officer", target = owner, ownerUid = "owner"))
        assertFalse(MemberRules.canChangeRole(actorUid = "owner", target = owner, ownerUid = "owner"))
    }

    @Test
    fun nobody_canChangeTheirOwnRole() {
        assertFalse(MemberRules.canChangeRole(actorUid = "officer", target = officer, ownerUid = "owner"))
    }

    @Test
    fun othersRoles_canBeChanged() {
        assertTrue(MemberRules.canChangeRole(actorUid = "owner", target = student, ownerUid = "owner"))
        assertTrue(MemberRules.canChangeRole(actorUid = "officer", target = student, ownerUid = "owner"))
    }

    @Test
    fun owner_cannotBeRemoved_andNobodyRemovesThemselves() {
        assertFalse(MemberRules.canRemove("officer", owner, "owner"))
        assertFalse(MemberRules.canRemove("student", student, "owner"))
        assertTrue(MemberRules.canRemove("owner", student, "owner"))
    }

    @Test
    fun assignableRoles_neverIncludeTheLockedMayor() {
        val assignable = MemberRules.assignableRoles(DefaultRoles.all()).map { it.id }
        assertFalse(ROLE_MAYOR in assignable)
        assertEquals(3, assignable.size)
    }

    @Test
    fun holders_countsMembersWithThatRole() {
        val treasurer = DefaultRoles.all().first { it.id == ROLE_TREASURER }
        assertEquals(1, MemberRules.holders(treasurer, listOf(owner, officer, student)))
    }

    @Test
    fun courseName_mustBeNonBlank_shortEnough_andUnique() {
        val existing = listOf(Course(id = "or", name = "Operations Research"))
        assertFalse(CourseRules.isNameValid("  ", existing))
        assertFalse(CourseRules.isNameValid("x".repeat(41), existing))
        assertFalse(CourseRules.isNameValid("operations research", existing))
        assertTrue(CourseRules.isNameValid("Modern Geometry", existing))
        assertTrue(CourseRules.isNameValid("Operations Research", existing, editingId = "or"))
    }

    @Test
    fun takers_skipMembersWhoExcludeTheCourse() {
        val members = listOf(owner, officer, student)
        assertEquals(2, CourseRules.takers(Course(id = "or", name = "OR"), members))
        assertEquals(3, CourseRules.takers(Course(id = "swe", name = "SWE"), members))
    }
}

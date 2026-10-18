package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.RecordType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChargePlannerTest {
    private val ana = Member(id = "ana", name = "Ana")
    private val lito = Member(id = "lito", name = "Lito", excludedCourseIds = listOf("or"))
    private val kim = Member(id = "kim", name = "Kim", excludedCourseIds = listOf("or", "swe"))
    private val members = listOf(ana, lito, kim)

    @Test
    fun eligible_skipsMembersWhoExcludeTheCourse() {
        assertEquals(listOf("ana"), ChargePlanner.eligible(members, "or").map { it.id })
        assertEquals(listOf("ana", "lito"), ChargePlanner.eligible(members, "swe").map { it.id })
    }

    @Test
    fun eligible_blankCourse_meansEveryone() {
        assertEquals(3, ChargePlanner.eligible(members, "").size)
    }

    @Test
    fun eligible_newCourse_includesEveryoneByDefault() {
        assertEquals(3, ChargePlanner.eligible(members, "brandNewCourse").size)
    }

    @Test
    fun preview_totalIsPerMemberTimesChargedCount() {
        val preview = ChargePlanner.preview(members, "swe", perMemberCentavos = 600)
        assertEquals(2, preview.charged.size)
        assertEquals(1, preview.skipped.size)
        assertEquals(1_200L, preview.totalCentavos)
    }

    @Test
    fun preview_forceInclude_addsAnExcludedMember() {
        val preview = ChargePlanner.preview(members, "or", 600, forceInclude = setOf("lito"))
        assertEquals(setOf("ana", "lito"), preview.charged.map { it.id }.toSet())
        assertEquals(listOf("kim"), preview.skipped.map { it.id })
    }

    @Test
    fun preview_forceExclude_removesAnEligibleMember() {
        val preview = ChargePlanner.preview(members, "", 600, forceExclude = setOf("ana"))
        assertEquals(setOf("lito", "kim"), preview.charged.map { it.id }.toSet())
    }

    @Test
    fun preview_noOneEligible_totalsZero() {
        val preview = ChargePlanner.preview(listOf(kim), "or", 600)
        assertTrue(preview.charged.isEmpty())
        assertEquals(0L, preview.totalCentavos)
    }

    @Test
    fun buildRecords_makesOneChargePerChargedMember_sharingTheBatchId() {
        val preview = ChargePlanner.preview(members, "swe", 600)
        val records = ChargePlanner.buildRecords(preview, "Quiz - SWE", "swe", dateMillis = 1_000L, batchId = "b1")
        assertEquals(2, records.size)
        assertTrue(records.all { it.type == RecordType.CHARGE && it.batchId == "b1" && it.amountCentavos == 600L })
        assertEquals(listOf("ana", "lito"), records.map { it.memberId })
        assertEquals("Quiz - SWE", records.first().note)
        assertEquals("swe", records.first().courseId)
    }

    @Test
    fun chargedRecords_lowerEachChargedMembersBalance_andLeaveSkippedMembersAlone() {
        val preview = ChargePlanner.preview(members, "or", 600)
        val records = ChargePlanner.buildRecords(preview, "Quiz - OR", "or", 0L, "b2")
        val balances = Ledger.memberBalances(members, records)
        assertEquals(-600L, balances["ana"])
        assertEquals(0L, balances["lito"])
        assertEquals(0L, balances["kim"])
        assertEquals(0L, Ledger.cashOnHand(records))
    }
}

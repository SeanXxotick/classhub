package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.RecordType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The cross-check between charges and pay-outs, using the ₱6 OR quiz example. */
class PayoutTest {
    private val students = (1..30).map { Member(id = "s$it", name = "Student $it") }

    private val payments = students.map {
        LedgerRecord(id = "p-${it.id}", type = RecordType.PAYMENT, amountCentavos = 10_000, memberId = it.id, memberName = it.name, dateMillis = 1)
    }

    private fun quizCharge(batch: String = "quiz") = ChargePlanner.buildRecords(
        ChargePlanner.preview(students, "", 600), "Quiz - OR", "", dateMillis = 2, batchId = batch,
    ).mapIndexed { i, r -> r.copy(id = "$batch-$i") }

    private fun payout(batch: String = "quiz", amount: Long = 18_000) =
        ChargePlanner.buildPayout(batch, amount, "Quiz - OR", dateMillis = 3, paidTo = " Prof. Santos ").copy(id = "e-$batch")

    @Test
    fun afterPaymentsOnly_cashMatchesBalances_andBooksBalance() {
        assertEquals(300_000L, Ledger.cashOnHand(payments))
        assertEquals(0L, Ledger.awaitingPayout(payments))
        assertEquals(0L, Ledger.booksDifference(payments))
    }

    @Test
    fun afterACharge_theMoneyWaitsToBePaidOut_andBooksStillBalance() {
        val records = payments + quizCharge()
        assertEquals(300_000L, Ledger.cashOnHand(records))
        assertEquals(18_000L, Ledger.awaitingPayout(records))
        assertEquals(282_000L, Ledger.availableCash(records))
        assertEquals(0L, Ledger.booksDifference(records))
        assertEquals(listOf("quiz"), LedgerView.unpaidCharges(records).map { it.batchId })
    }

    @Test
    fun afterThePayout_nothingWaits_cashDrops_andBooksStillBalance() {
        val records = payments + quizCharge() + payout()
        assertEquals(282_000L, Ledger.cashOnHand(records))
        assertEquals(0L, Ledger.awaitingPayout(records))
        assertEquals(282_000L, Ledger.availableCash(records))
        assertEquals(0L, Ledger.booksDifference(records))
        assertTrue(LedgerView.unpaidCharges(records).isEmpty())
        assertEquals(setOf("quiz"), Ledger.paidOutBatchIds(records))
    }

    @Test
    fun payoutIsExactlyTheChargeTotal_andLinksBack() {
        val charge = LedgerView.entries(quizCharge()).filterIsInstance<LedgerEntry.ChargeBatch>().single()
        val p = ChargePlanner.buildPayout(charge.batchId, charge.totalCentavos, charge.note, 3, "Prof. Santos")
        assertEquals(18_000L, p.amountCentavos)
        assertEquals("quiz", p.settlesBatchId)
        assertEquals(RecordType.EXPENSE, p.type)
        assertEquals("", p.memberId)
    }

    @Test
    fun paidTo_isTrimmed() {
        assertEquals("Prof. Santos", payout().paidTo)
    }

    @Test
    fun payoutFor_andChargeFor_findEachOther() {
        val records = payments + quizCharge() + payout()
        assertEquals("e-quiz", LedgerView.payoutFor("quiz", records)?.id)
        assertEquals("quiz", LedgerView.chargeFor(payout(), records)?.batchId)
        assertNull(LedgerView.payoutFor("other", records))
    }

    @Test
    fun payoutWithoutItsCharge_isCaughtByTheBooksCheck() {
        val records = payments + payout()
        assertEquals(-18_000L, Ledger.booksDifference(records))
    }

    @Test
    fun aChargeWithNoBatch_isCaughtByTheBooksCheck() {
        val stray = LedgerRecord(type = RecordType.CHARGE, amountCentavos = 600, memberId = "s1")
        assertEquals(600L, Ledger.booksDifference(payments + stray))
    }

    @Test
    fun withdrawals_keepTheBooksBalanced() {
        val w = LedgerRecord(type = RecordType.WITHDRAWAL, amountCentavos = 5_000, memberId = "s1")
        assertEquals(0L, Ledger.booksDifference(payments + quizCharge() + payout() + w))
    }

    @Test
    fun removedMembersStillCount_inTheBooksCheck() {
        val gone = LedgerRecord(type = RecordType.PAYMENT, amountCentavos = 2_000, memberId = "left-the-class")
        assertEquals(0L, Ledger.booksDifference(payments + gone))
    }

    @Test
    fun toPayOutFilter_listsOnlyUnpaidCharges_oldestFirst() {
        val records = payments + quizCharge("old").map { it.copy(dateMillis = 2) } +
            quizCharge("new").map { it.copy(dateMillis = 5) } + quizCharge("done") + payout("done")
        assertEquals(listOf("b:old", "b:new"), LedgerView.filter(records, LedgerFilter.TO_PAY_OUT, "").map { it.key })
    }
}

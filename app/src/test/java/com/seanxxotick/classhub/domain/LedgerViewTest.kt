package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.RecordType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerViewTest {
    private fun rec(id: String, type: RecordType, pesos: Long, member: String = "", date: Long = 0, batch: String = "", note: String = "") =
        LedgerRecord(id = id, type = type, amountCentavos = pesos * 100, memberId = member, memberName = member, dateMillis = date, batchId = batch, note = note)

    private val records = listOf(
        rec("p1", RecordType.PAYMENT, 100, member = "ana", date = 10),
        rec("c1", RecordType.CHARGE, 6, member = "ana", date = 20, batch = "b1", note = "Quiz - OR"),
        rec("c2", RecordType.CHARGE, 6, member = "lito", date = 20, batch = "b1", note = "Quiz - OR"),
        rec("c3", RecordType.CHARGE, 6, member = "kim", date = 20, batch = "b1", note = "Quiz - OR"),
        rec("w1", RecordType.WITHDRAWAL, 50, member = "lito", date = 30),
        rec("e1", RecordType.EXPENSE, 18, date = 40, note = "Printing"),
    )

    @Test
    fun entries_foldEachChargeBatchIntoOneLine_newestFirst() {
        val entries = LedgerView.entries(records)
        assertEquals(4, entries.size)
        assertEquals(listOf("r:e1", "r:w1", "b:b1", "r:p1"), entries.map { it.key })
    }

    @Test
    fun chargeBatch_reportsCountTotalAndPerStudentAmount() {
        val batch = LedgerView.entries(records).filterIsInstance<LedgerEntry.ChargeBatch>().single()
        assertEquals(3, batch.count)
        assertEquals(1_800L, batch.totalCentavos)
        assertEquals(600L, batch.perMemberCentavos)
        assertEquals("Quiz - OR", batch.note)
    }

    @Test
    fun chargeBatch_withMixedAmounts_hasNoSinglePerStudentAmount() {
        val mixed = listOf(
            rec("a", RecordType.CHARGE, 6, member = "ana", batch = "b"),
            rec("b", RecordType.CHARGE, 7, member = "lito", batch = "b"),
        )
        assertNull((LedgerView.entries(mixed).single() as LedgerEntry.ChargeBatch).perMemberCentavos)
    }

    @Test
    fun chargeWithoutBatchId_staysASingleLine() {
        val entries = LedgerView.entries(listOf(rec("x", RecordType.CHARGE, 6, member = "ana")))
        assertTrue(entries.single() is LedgerEntry.Single)
    }

    @Test
    fun mine_listsOnlyMyRecords_includingMyShareOfACharge() {
        val mine = LedgerView.filter(records, LedgerFilter.MINE, "lito")
        assertEquals(listOf("r:w1", "r:c2"), mine.map { it.key })
    }

    @Test
    fun typeFilters_keepOnlyThatType() {
        assertEquals(listOf("r:p1"), LedgerView.filter(records, LedgerFilter.PAYMENTS, "").map { it.key })
        assertEquals(listOf("b:b1"), LedgerView.filter(records, LedgerFilter.CHARGES, "").map { it.key })
        assertEquals(listOf("r:w1"), LedgerView.filter(records, LedgerFilter.WITHDRAWALS, "").map { it.key })
        assertEquals(listOf("r:e1"), LedgerView.filter(records, LedgerFilter.PAYOUTS, "").map { it.key })
    }

    @Test
    fun displayAmount_isPositiveOnlyForPayments() {
        val byKey = LedgerView.entries(records).associateBy { it.key }
        assertEquals(10_000L, LedgerView.displayAmount(byKey.getValue("r:p1")))
        assertEquals(-1_800L, LedgerView.displayAmount(byKey.getValue("b:b1")))
        assertEquals(-5_000L, LedgerView.displayAmount(byKey.getValue("r:w1")))
        assertEquals(-1_800L, LedgerView.displayAmount(byKey.getValue("r:e1")))
    }

    @Test
    fun statement_isOneMembersRecords_newestFirst() {
        assertEquals(listOf("c1", "p1"), LedgerView.statement("ana", records).map { it.id })
    }
}

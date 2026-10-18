package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.RecordType
import org.junit.Assert.assertEquals
import org.junit.Test

class LedgerTest {
    private fun record(type: RecordType, member: String, pesos: Long) = LedgerRecord(
        type = type, amountCentavos = pesos * 100, memberId = member,
    )

    private fun payment(member: String, pesos: Long) = record(RecordType.PAYMENT, member, pesos)
    private fun charge(member: String, pesos: Long) = record(RecordType.CHARGE, member, pesos)
    private fun withdrawal(member: String, pesos: Long) = record(RecordType.WITHDRAWAL, member, pesos)
    private fun expense(pesos: Long) = record(RecordType.EXPENSE, "", pesos)

    private val ana = Member(id = "ana", name = "Ana")
    private val lito = Member(id = "lito", name = "Lito")
    private val kim = Member(id = "kim", name = "Kim")

    @Test
    fun payment_raisesBothMemberBalanceAndCash() {
        val r = payment("ana", 100)
        assertEquals(10_000L, Ledger.memberDelta(r))
        assertEquals(10_000L, Ledger.cashDelta(r))
    }

    @Test
    fun charge_lowersMemberBalance_butDoesNotMoveCash() {
        val r = charge("ana", 6)
        assertEquals(-600L, Ledger.memberDelta(r))
        assertEquals(0L, Ledger.cashDelta(r))
    }

    @Test
    fun withdrawal_lowersBothMemberBalanceAndCash() {
        val r = withdrawal("ana", 50)
        assertEquals(-5_000L, Ledger.memberDelta(r))
        assertEquals(-5_000L, Ledger.cashDelta(r))
    }

    @Test
    fun expense_lowersCash_butNoMemberBalance() {
        val r = expense(380)
        assertEquals(0L, Ledger.memberDelta(r))
        assertEquals(-38_000L, Ledger.cashDelta(r))
    }

    @Test
    fun cashOnHand_isPaymentsMinusWithdrawalsMinusExpenses_chargesIgnored() {
        val records = listOf(
            payment("ana", 100), payment("lito", 50),
            charge("ana", 6), charge("lito", 6),
            withdrawal("ana", 20), expense(30),
        )
        assertEquals(10_000L, Ledger.cashOnHand(records))
    }

    @Test
    fun cashOnHand_emptyList_isZero() {
        assertEquals(0L, Ledger.cashOnHand(emptyList()))
    }

    @Test
    fun total_sumsOneTypeOnly() {
        val records = listOf(payment("ana", 100), payment("lito", 50), charge("ana", 6), expense(30))
        assertEquals(15_000L, Ledger.total(records, RecordType.PAYMENT))
        assertEquals(600L, Ledger.total(records, RecordType.CHARGE))
        assertEquals(0L, Ledger.total(records, RecordType.WITHDRAWAL))
        assertEquals(3_000L, Ledger.total(records, RecordType.EXPENSE))
    }

    @Test
    fun memberBalances_combinePaymentsChargesAndWithdrawals() {
        val records = listOf(
            payment("ana", 100), charge("ana", 6), charge("ana", 6), withdrawal("ana", 30),
            payment("lito", 50), charge("lito", 6),
        )
        val balances = Ledger.memberBalances(listOf(ana, lito), records)
        assertEquals(5_800L, balances["ana"])
        assertEquals(4_400L, balances["lito"])
    }

    @Test
    fun memberBalances_memberWithNoRecords_isZero() {
        val balances = Ledger.memberBalances(listOf(ana, kim), listOf(payment("ana", 10)))
        assertEquals(0L, balances["kim"])
    }

    @Test
    fun memberBalances_ignoresExpenses() {
        val balances = Ledger.memberBalances(listOf(ana), listOf(payment("ana", 10), expense(500)))
        assertEquals(1_000L, balances["ana"])
    }

    @Test
    fun memberBalance_canGoNegative_whenChargedMoreThanPaid() {
        val balances = Ledger.memberBalances(listOf(lito), listOf(payment("lito", 5), charge("lito", 6)))
        assertEquals(-100L, balances["lito"])
    }

    @Test
    fun status_matchesSignOfBalance() {
        assertEquals(BalanceStatus.OWES, Ledger.status(-1))
        assertEquals(BalanceStatus.CREDIT, Ledger.status(1))
        assertEquals(BalanceStatus.SETTLED, Ledger.status(0))
    }

    @Test
    fun amountsStayExact_withManySmallPayments() {
        val records = List(1_000) { LedgerRecord(type = RecordType.PAYMENT, amountCentavos = 10) }
        assertEquals(10_000L, Ledger.cashOnHand(records))
    }
}

package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.RecordType

enum class BalanceStatus { OWES, CREDIT, SETTLED }

/** Pure ledger math, kept free of Android and Firebase so it can be unit tested. */
object Ledger {
    /** Effect on the member's own balance. An EXPENSE has no member, so it is 0. */
    fun memberDelta(record: LedgerRecord): Long = when (record.type) {
        RecordType.PAYMENT -> record.amountCentavos
        RecordType.CHARGE, RecordType.WITHDRAWAL -> -record.amountCentavos
        RecordType.EXPENSE -> 0L
    }

    /** Effect on the class's cash. A CHARGE only reassigns cost between members, so it is 0. */
    fun cashDelta(record: LedgerRecord): Long = when (record.type) {
        RecordType.PAYMENT -> record.amountCentavos
        RecordType.WITHDRAWAL, RecordType.EXPENSE -> -record.amountCentavos
        RecordType.CHARGE -> 0L
    }

    fun cashOnHand(records: List<LedgerRecord>): Long = records.sumOf { cashDelta(it) }

    fun total(records: List<LedgerRecord>, type: RecordType): Long =
        records.filter { it.type == type }.sumOf { it.amountCentavos }

    /** Balance per member id. Members with no records are included at zero. */
    fun memberBalances(members: List<Member>, records: List<LedgerRecord>): Map<String, Long> {
        val byMember = records
            .filter { it.memberId.isNotEmpty() }
            .groupBy { it.memberId }
            .mapValues { (_, list) -> list.sumOf { memberDelta(it) } }
        return members.associate { it.id to (byMember[it.id] ?: 0L) }
    }

    /** Batch ids of charges that a pay-out has settled. */
    fun paidOutBatchIds(records: List<LedgerRecord>): Set<String> =
        records.filter { it.type == RecordType.EXPENSE && it.settlesBatchId.isNotEmpty() }.map { it.settlesBatchId }.toSet()

    /** Money charged to students that has not been paid out yet (still owed to professors and others). */
    fun awaitingPayout(records: List<LedgerRecord>): Long {
        val paid = paidOutBatchIds(records)
        return records.filter { it.type == RecordType.CHARGE && it.batchId.isNotEmpty() && it.batchId !in paid }.sumOf { it.amountCentavos }
    }

    /** Cash that is not already owed for a charge. */
    fun availableCash(records: List<LedgerRecord>): Long = cashOnHand(records) - awaitingPayout(records)

    /**
     * The books balance when cash on hand equals everyone's balances plus charges not yet paid out.
     * Returns the difference in centavos: 0 means balanced. Every member who ever had a record counts,
     * including people who were later removed from the class.
     */
    fun booksDifference(records: List<LedgerRecord>): Long {
        val allBalances = records.filter { it.memberId.isNotEmpty() }.sumOf { memberDelta(it) }
        return cashOnHand(records) - allBalances - awaitingPayout(records)
    }

    fun status(balanceCentavos: Long): BalanceStatus = when {
        balanceCentavos < 0 -> BalanceStatus.OWES
        balanceCentavos > 0 -> BalanceStatus.CREDIT
        else -> BalanceStatus.SETTLED
    }
}

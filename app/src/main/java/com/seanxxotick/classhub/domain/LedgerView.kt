package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.RecordType

/** One line in the ledger list. A charge to many students shows as a single [ChargeBatch] line. */
sealed interface LedgerEntry {
    val key: String
    val type: RecordType
    val dateMillis: Long

    data class Single(val record: LedgerRecord) : LedgerEntry {
        override val key: String get() = "r:" + record.id
        override val type: RecordType get() = record.type
        override val dateMillis: Long get() = record.dateMillis
    }

    data class ChargeBatch(val batchId: String, val records: List<LedgerRecord>) : LedgerEntry {
        override val key: String get() = "b:$batchId"
        override val type: RecordType get() = RecordType.CHARGE
        override val dateMillis: Long get() = records.maxOf { it.dateMillis }
        val note: String get() = records.first().note
        val courseId: String get() = records.first().courseId
        val count: Int get() = records.size
        val totalCentavos: Long get() = records.sumOf { it.amountCentavos }

        /** The amount each student was charged, or null if the amounts differ. */
        val perMemberCentavos: Long? get() = records.map { it.amountCentavos }.distinct().singleOrNull()
    }
}

enum class LedgerFilter(val label: String) {
    ALL("All"),
    MINE("Mine"),
    TO_PAY_OUT("To pay out"),
    PAYMENTS("Payments"),
    CHARGES("Charges"),
    WITHDRAWALS("Withdrawals"),
    PAYOUTS("Pay-outs"),
}

object LedgerView {
    /** Newest first. CHARGE records that share a batch id are folded into one [LedgerEntry.ChargeBatch]. */
    fun entries(records: List<LedgerRecord>): List<LedgerEntry> {
        val (batched, singles) = records.partition { it.type == RecordType.CHARGE && it.batchId.isNotEmpty() }
        val batches = batched.groupBy { it.batchId }.map { (id, list) -> LedgerEntry.ChargeBatch(id, list.sortedBy { it.memberName.lowercase() }) }
        return (singles.map { LedgerEntry.Single(it) } + batches).sortedByDescending { it.dateMillis }
    }

    /**
     * Applies a filter chip. "Mine" lists [myUid]'s own records one by one (including their share of
     * each charge), so a student sees exactly what moved their balance.
     */
    fun filter(records: List<LedgerRecord>, filter: LedgerFilter, myUid: String): List<LedgerEntry> = when (filter) {
        LedgerFilter.ALL -> entries(records)
        LedgerFilter.MINE -> records.filter { it.memberId == myUid }.sortedByDescending { it.dateMillis }.map { LedgerEntry.Single(it) }
        LedgerFilter.TO_PAY_OUT -> unpaidCharges(records)
        LedgerFilter.PAYMENTS -> entries(records.filter { it.type == RecordType.PAYMENT })
        LedgerFilter.CHARGES -> entries(records.filter { it.type == RecordType.CHARGE })
        LedgerFilter.WITHDRAWALS -> entries(records.filter { it.type == RecordType.WITHDRAWAL })
        LedgerFilter.PAYOUTS -> entries(records.filter { it.type == RecordType.EXPENSE })
    }

    /** Charges that no pay-out has settled yet, oldest first (the order to pay them in). */
    fun unpaidCharges(records: List<LedgerRecord>): List<LedgerEntry.ChargeBatch> {
        val paid = Ledger.paidOutBatchIds(records)
        return entries(records.filter { it.type == RecordType.CHARGE && it.batchId.isNotEmpty() && it.batchId !in paid })
            .filterIsInstance<LedgerEntry.ChargeBatch>()
            .sortedBy { it.dateMillis }
    }

    /** The pay-out that settled [batchId], if any. */
    fun payoutFor(batchId: String, records: List<LedgerRecord>): LedgerRecord? =
        records.firstOrNull { it.type == RecordType.EXPENSE && it.settlesBatchId == batchId }

    /** The charge a pay-out settled, if it still exists. */
    fun chargeFor(payout: LedgerRecord, records: List<LedgerRecord>): LedgerEntry.ChargeBatch? =
        entries(records.filter { it.type == RecordType.CHARGE && it.batchId == payout.settlesBatchId })
            .filterIsInstance<LedgerEntry.ChargeBatch>()
            .firstOrNull()

    /** A member's own records, newest first. */
    fun statement(memberId: String, records: List<LedgerRecord>): List<LedgerRecord> =
        records.filter { it.memberId == memberId }.sortedByDescending { it.dateMillis }

    /** Signed amount shown on a ledger line, from the class fund's point of view for pay-outs. */
    fun displayAmount(entry: LedgerEntry): Long = when (entry) {
        is LedgerEntry.Single -> when (entry.record.type) {
            RecordType.PAYMENT -> entry.record.amountCentavos
            else -> -entry.record.amountCentavos
        }
        is LedgerEntry.ChargeBatch -> -entry.totalCentavos
    }
}

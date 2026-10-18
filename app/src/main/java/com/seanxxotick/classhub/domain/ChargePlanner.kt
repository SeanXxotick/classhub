package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.RecordType

/** What the "New charge" screen shows before the treasurer taps Save. */
data class ChargePreview(
    val charged: List<Member>,
    val skipped: List<Member>,
    val perMemberCentavos: Long,
) {
    val totalCentavos: Long get() = perMemberCentavos * charged.size
}

object ChargePlanner {
    /** Members who take the course. A blank [courseId] means the whole class. */
    fun eligible(members: List<Member>, courseId: String): List<Member> =
        if (courseId.isEmpty()) members else members.filter { courseId !in it.excludedCourseIds }

    /**
     * Who gets charged. Starts from [eligible], then applies the treasurer's manual overrides:
     * [forceInclude] adds someone who would have been skipped, [forceExclude] removes someone.
     */
    fun preview(
        members: List<Member>,
        courseId: String,
        perMemberCentavos: Long,
        forceInclude: Set<String> = emptySet(),
        forceExclude: Set<String> = emptySet(),
    ): ChargePreview {
        val eligibleIds = eligible(members, courseId).map { it.id }.toSet()
        val chargedIds = (eligibleIds + forceInclude) - forceExclude
        val (charged, skipped) = members.partition { it.id in chargedIds }
        return ChargePreview(charged, skipped, perMemberCentavos)
    }

    /** The pay-out that settles a charge: always exactly the charge's total, linked by [batchId]. */
    fun buildPayout(batchId: String, totalCentavos: Long, note: String, dateMillis: Long, paidTo: String): LedgerRecord =
        LedgerRecord(
            type = RecordType.EXPENSE,
            amountCentavos = totalCentavos,
            note = note,
            dateMillis = dateMillis,
            settlesBatchId = batchId,
            paidTo = paidTo.trim(),
        )

    /** One CHARGE record per charged member, all sharing [batchId] so they can be undone together. */
    fun buildRecords(
        preview: ChargePreview,
        note: String,
        courseId: String,
        dateMillis: Long,
        batchId: String,
    ): List<LedgerRecord> = preview.charged.map { member ->
        LedgerRecord(
            type = RecordType.CHARGE,
            amountCentavos = preview.perMemberCentavos,
            memberId = member.id,
            memberName = member.name,
            note = note,
            dateMillis = dateMillis,
            batchId = batchId,
            courseId = courseId,
        )
    }
}

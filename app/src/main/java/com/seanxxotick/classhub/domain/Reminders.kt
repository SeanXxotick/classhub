package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.ScheduleItem
import java.time.ZoneId

/** What a notification says. The worker turns these into phone notifications. */
data class ReminderText(val title: String, val body: String)

/**
 * Decides which daily reminders to show. Pure logic, so it can be unit tested;
 * the background worker only loads data and posts what this returns.
 */
object Reminders {
    const val WEEK_MILLIS = 7L * 24 * 60 * 60 * 1000

    /** Items due tomorrow that this student has not marked done and that were not cancelled. */
    fun dueTomorrow(items: List<ScheduleItem>, doneIds: Set<String>, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): List<ScheduleItem> =
        items.filter { ScheduleLogic.isOpen(it, doneIds) && ScheduleLogic.daysUntil(it.dueMillis, nowMillis, zone) == 1L }
            .sortedBy { it.title.lowercase() }

    /** Contents added after [sinceMillis], newest first. A first run (since = 0) reports nothing, to avoid a flood. */
    fun newContents(contents: List<ContentItem>, sinceMillis: Long): List<ContentItem> =
        if (sinceMillis <= 0L) emptyList()
        else contents.filter { it.createdAtMillis > sinceMillis }.sortedByDescending { it.createdAtMillis }

    /**
     * Whether to remind a student who owes money: when they owe and either a week has passed
     * since the last reminder or the amount changed.
     */
    fun shouldRemindOwing(balanceCentavos: Long, lastRemindedMillis: Long, lastRemindedBalance: Long, nowMillis: Long): Boolean =
        balanceCentavos < 0 && (nowMillis - lastRemindedMillis >= WEEK_MILLIS || balanceCentavos != lastRemindedBalance)

    /** Whether to send the weekly "who still owes" summary to ledger officers. */
    fun shouldSendWeeklySummary(lastSentMillis: Long, nowMillis: Long): Boolean = nowMillis - lastSentMillis >= WEEK_MILLIS

    /** Current members who owe, largest debt first. */
    fun owingMembers(members: List<Member>, records: List<LedgerRecord>): List<Pair<Member, Long>> {
        val balances = Ledger.memberBalances(members, records)
        return members.mapNotNull { m -> balances[m.id]?.takeIf { it < 0 }?.let { m to it } }
            .sortedBy { it.second }
    }

    // ---- Wording (no contractions, per the app's style) ----

    fun dueTomorrowText(className: String, items: List<ScheduleItem>): ReminderText = when (items.size) {
        1 -> ReminderText("Due tomorrow: ${items[0].title}", "$className. Mark it done in ClassHub when you finish.")
        else -> ReminderText(
            "${items.size} items due tomorrow",
            "$className: " + items.take(3).joinToString(", ") { it.title } + if (items.size > 3) ", and more" else "",
        )
    }

    fun newContentsText(className: String, items: List<ContentItem>): ReminderText = when (items.size) {
        1 -> ReminderText("New in $className: ${items[0].title}", "A new class material was shared. Open ClassHub to view it.")
        else -> ReminderText(
            "${items.size} new class materials",
            "$className: " + items.take(3).joinToString(", ") { it.title } + if (items.size > 3) ", and more" else "",
        )
    }

    fun owingText(className: String, balanceCentavos: Long): ReminderText = ReminderText(
        "You owe ${Money.format(-balanceCentavos)}",
        "Your balance in $className is short by ${Money.format(-balanceCentavos)}. Please settle it with your class officers.",
    )

    fun weeklySummaryText(className: String, owing: List<Pair<Member, Long>>): ReminderText {
        val total = owing.sumOf { -it.second }
        return ReminderText(
            "${owing.size} member${if (owing.size == 1) "" else "s"} still owe${if (owing.size == 1) "s" else ""} ${Money.format(total)}",
            "$className: " + owing.take(3).joinToString(", ") { "${it.first.name} ${Money.format(-it.second)}" } +
                if (owing.size > 3) ", and more" else "",
        )
    }
}

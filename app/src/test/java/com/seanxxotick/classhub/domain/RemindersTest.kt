package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.RecordType
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class RemindersTest {
    private val zone = ZoneId.of("Asia/Manila")
    private fun noon(day: Int) = LocalDate.of(2026, 10, day).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()

    // Monday, October 19, 2026, 6 PM
    private val now = LocalDate.of(2026, 10, 19).atTime(18, 0).atZone(zone).toInstant().toEpochMilli()

    @Test
    fun dueTomorrow_isOpenItemsForTomorrowOnly() {
        val items = listOf(
            ScheduleItem(id = "midterm", title = "Midterm", dueMillis = noon(20)),
            ScheduleItem(id = "quiz", title = "Quiz", dueMillis = noon(20)),
            ScheduleItem(id = "done", title = "Done already", dueMillis = noon(20)),
            ScheduleItem(id = "cancelled", title = "Cancelled", dueMillis = noon(20), status = ScheduleStatus.CANCELLED),
            ScheduleItem(id = "today", title = "Today", dueMillis = noon(19)),
            ScheduleItem(id = "later", title = "Later", dueMillis = noon(22)),
        )
        assertEquals(listOf("midterm", "quiz"), Reminders.dueTomorrow(items, setOf("done"), now, zone).map { it.id })
    }

    @Test
    fun newContents_onlyAfterTheLastCheck_andNothingOnTheFirstRun() {
        val items = listOf(
            ContentItem(id = "old", title = "Old", createdAtMillis = 100),
            ContentItem(id = "new1", title = "New 1", createdAtMillis = 300),
            ContentItem(id = "new2", title = "New 2", createdAtMillis = 400),
        )
        assertEquals(listOf("new2", "new1"), Reminders.newContents(items, sinceMillis = 200).map { it.id })
        assertTrue(Reminders.newContents(items, sinceMillis = 0).isEmpty())
    }

    @Test
    fun owingReminder_weeklyOrWhenTheAmountChanges() {
        val week = Reminders.WEEK_MILLIS
        assertFalse(Reminders.shouldRemindOwing(balanceCentavos = 500, lastRemindedMillis = 0, lastRemindedBalance = 0, nowMillis = week * 10))
        assertTrue(Reminders.shouldRemindOwing(-800, lastRemindedMillis = 0, lastRemindedBalance = 0, nowMillis = week * 10))
        assertFalse(Reminders.shouldRemindOwing(-800, lastRemindedMillis = now - 1000, lastRemindedBalance = -800, nowMillis = now))
        assertTrue(Reminders.shouldRemindOwing(-1400, lastRemindedMillis = now - 1000, lastRemindedBalance = -800, nowMillis = now))
        assertTrue(Reminders.shouldRemindOwing(-800, lastRemindedMillis = now - week, lastRemindedBalance = -800, nowMillis = now))
    }

    @Test
    fun weeklySummary_onceAWeek() {
        assertTrue(Reminders.shouldSendWeeklySummary(lastSentMillis = 0, nowMillis = now))
        assertFalse(Reminders.shouldSendWeeklySummary(lastSentMillis = now - 1000, nowMillis = now))
    }

    @Test
    fun owingMembers_listsOnlyNegativeBalances_largestFirst() {
        val members = listOf(Member(id = "a", name = "Ana"), Member(id = "l", name = "Lito"), Member(id = "k", name = "Kim"))
        val records = listOf(
            LedgerRecord(type = RecordType.PAYMENT, amountCentavos = 1000, memberId = "a"),
            LedgerRecord(type = RecordType.CHARGE, amountCentavos = 600, memberId = "l", batchId = "b"),
            LedgerRecord(type = RecordType.CHARGE, amountCentavos = 1200, memberId = "k", batchId = "b2"),
        )
        assertEquals(listOf("Kim", "Lito"), Reminders.owingMembers(members, records).map { it.first.name })
    }

    @Test
    fun texts_readWell_andUseNoContractions() {
        val one = Reminders.dueTomorrowText("BSM CS 3A", listOf(ScheduleItem(title = "Midterm")))
        assertEquals("Due tomorrow: Midterm", one.title)
        val many = Reminders.dueTomorrowText("BSM CS 3A", (1..5).map { ScheduleItem(title = "Item $it") })
        assertEquals("5 items due tomorrow", many.title)
        assertTrue(many.body.endsWith(", and more"))
        assertEquals("You owe ₱8.00", Reminders.owingText("BSM CS 3A", -800).title)
        assertEquals("1 member still owes ₱6.00", Reminders.weeklySummaryText("X", listOf(Member(name = "Lito") to -600L)).title)
        val all = listOf(one, many, Reminders.owingText("X", -800), Reminders.newContentsText("X", listOf(ContentItem(title = "M1"))))
        val contraction = Regex("\\b\\w+(n't|'re|'ll|'ve|'m|'d)\\b", RegexOption.IGNORE_CASE)
        all.forEach { assertFalse(it.toString(), contraction.containsMatchIn(it.title + " " + it.body)) }
    }
}

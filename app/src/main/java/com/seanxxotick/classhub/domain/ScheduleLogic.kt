package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Deadlines are shared by the class, but finishing them is personal: each student marks items done
 * for themselves. [doneIds] is the signed-in student's own set of finished item ids.
 * At class level an item is only active or cancelled (an older "submitted" status counts as active).
 */
object ScheduleLogic {
    /** Whole calendar days from now to the due date. Negative when the date has passed. */
    fun daysUntil(dueMillis: Long, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): Long {
        val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        val due = Instant.ofEpochMilli(dueMillis).atZone(zone).toLocalDate()
        return ChronoUnit.DAYS.between(today, due)
    }

    fun dateOf(millis: Long, zone: ZoneId = ZoneId.systemDefault()): LocalDate =
        Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()

    fun isCancelled(item: ScheduleItem): Boolean = item.status == ScheduleStatus.CANCELLED

    /** Still to do for this student: not cancelled for the class and not marked done by them. */
    fun isOpen(item: ScheduleItem, doneIds: Set<String>): Boolean = !isCancelled(item) && item.id !in doneIds

    /** Open items due today or later, soonest first. */
    fun upcoming(
        items: List<ScheduleItem>,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        doneIds: Set<String> = emptySet(),
    ): List<ScheduleItem> = items
        .filter { isOpen(it, doneIds) && daysUntil(it.dueMillis, nowMillis, zone) >= 0 }
        .sortedBy { it.dueMillis }

    /** Open items whose date has already passed. */
    fun overdue(
        items: List<ScheduleItem>,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        doneIds: Set<String> = emptySet(),
    ): List<ScheduleItem> = items
        .filter { isOpen(it, doneIds) && daysUntil(it.dueMillis, nowMillis, zone) < 0 }
        .sortedBy { it.dueMillis }

    /** "Today", "Tomorrow", "In 5 days", "3 days ago" */
    fun relativeLabel(days: Long): String = when {
        days == 0L -> "Today"
        days == 1L -> "Tomorrow"
        days > 1L -> "In $days days"
        days == -1L -> "Yesterday"
        else -> "${-days} days ago"
    }
}

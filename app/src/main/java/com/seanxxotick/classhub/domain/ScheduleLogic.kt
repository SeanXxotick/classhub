package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

object ScheduleLogic {
    /** Whole calendar days from now to the due date. Negative when the date has passed. */
    fun daysUntil(dueMillis: Long, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): Long {
        val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        val due = Instant.ofEpochMilli(dueMillis).atZone(zone).toLocalDate()
        return ChronoUnit.DAYS.between(today, due)
    }

    fun dateOf(millis: Long, zone: ZoneId = ZoneId.systemDefault()): LocalDate =
        Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()

    /** Pending items due today or later, soonest first. */
    fun upcoming(
        items: List<ScheduleItem>,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<ScheduleItem> = items
        .filter { it.status == ScheduleStatus.PENDING && daysUntil(it.dueMillis, nowMillis, zone) >= 0 }
        .sortedBy { it.dueMillis }

    /** Pending items whose date has already passed. */
    fun overdue(
        items: List<ScheduleItem>,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<ScheduleItem> = items
        .filter { it.status == ScheduleStatus.PENDING && daysUntil(it.dueMillis, nowMillis, zone) < 0 }
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

package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleStatus
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ScheduleLogicTest {
    private val zone = ZoneId.of("Asia/Manila")

    private fun millis(year: Int, month: Int, day: Int, hour: Int = 12): Long =
        LocalDate.of(year, month, day).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private val now = millis(2026, 10, 18, hour = 20)

    private fun item(id: String, due: Long, status: ScheduleStatus = ScheduleStatus.PENDING) =
        ScheduleItem(id = id, title = id, dueMillis = due, status = status)

    @Test
    fun daysUntil_countsCalendarDays_notHours() {
        assertEquals(0L, ScheduleLogic.daysUntil(millis(2026, 10, 18, hour = 1), now, zone))
        assertEquals(1L, ScheduleLogic.daysUntil(millis(2026, 10, 19, hour = 1), now, zone))
        assertEquals(12L, ScheduleLogic.daysUntil(millis(2026, 10, 30), now, zone))
        assertEquals(-2L, ScheduleLogic.daysUntil(millis(2026, 10, 16), now, zone))
    }

    @Test
    fun upcoming_keepsOnlyPendingItemsFromTodayOn_soonestFirst() {
        val items = listOf(
            item("later", millis(2026, 10, 30)),
            item("today", millis(2026, 10, 18)),
            item("soon", millis(2026, 10, 20)),
            item("past", millis(2026, 10, 10)),
            item("done", millis(2026, 10, 21), ScheduleStatus.SUBMITTED),
            item("cancelled", millis(2026, 10, 22), ScheduleStatus.CANCELLED),
        )
        assertEquals(listOf("today", "soon", "later"), ScheduleLogic.upcoming(items, now, zone).map { it.id })
    }

    @Test
    fun overdue_isPendingItemsWhoseDateHasPassed() {
        val items = listOf(
            item("past", millis(2026, 10, 10)),
            item("today", millis(2026, 10, 18)),
            item("pastDone", millis(2026, 10, 9), ScheduleStatus.SUBMITTED),
        )
        assertEquals(listOf("past"), ScheduleLogic.overdue(items, now, zone).map { it.id })
    }

    @Test
    fun relativeLabel_readsNaturally() {
        assertEquals("Today", ScheduleLogic.relativeLabel(0))
        assertEquals("Tomorrow", ScheduleLogic.relativeLabel(1))
        assertEquals("In 5 days", ScheduleLogic.relativeLabel(5))
        assertEquals("Yesterday", ScheduleLogic.relativeLabel(-1))
        assertEquals("3 days ago", ScheduleLogic.relativeLabel(-3))
    }
}

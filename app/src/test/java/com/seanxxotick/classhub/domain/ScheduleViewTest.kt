package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleKind
import com.seanxxotick.classhub.data.model.ScheduleStatus
import com.seanxxotick.classhub.data.model.StudentProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

class ScheduleViewTest {
    private val zone = ZoneId.of("Asia/Manila")

    private fun noon(y: Int, m: Int, d: Int) = LocalDate.of(y, m, d).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()

    // Monday, October 19, 2026, 8 PM
    private val now = LocalDate.of(2026, 10, 19).atTime(20, 0).atZone(zone).toInstant().toEpochMilli()

    private fun item(id: String, kind: ScheduleKind, day: Int, status: ScheduleStatus = ScheduleStatus.PENDING) =
        ScheduleItem(id = id, title = id, kind = kind, dueMillis = noon(2026, 10, day), status = status)

    private val items = listOf(
        item("orMidterm", ScheduleKind.EXAM, 20),
        item("sweQuiz", ScheduleKind.QUIZ, 22),
        item("mgAssign", ScheduleKind.DEADLINE, 22),
        item("sweFco", ScheduleKind.FCO, 27),
        item("lateReport", ScheduleKind.DEADLINE, 16),
        item("cancelledRec", ScheduleKind.RECITATION, 21, ScheduleStatus.CANCELLED),
    )

    /** What this student marked done. */
    private val mine = setOf("mgAssign")

    @Test
    fun upcoming_isMyOpenItemsFromToday_soonestFirst() {
        assertEquals(listOf("orMidterm", "sweQuiz", "sweFco"), ScheduleView.filter(items, ScheduleFilter.UPCOMING, now, zone, mine).map { it.id })
    }

    @Test
    fun overdue_isMyOpenItemsWithAPastDate() {
        assertEquals(listOf("lateReport"), ScheduleView.filter(items, ScheduleFilter.OVERDUE, now, zone, mine).map { it.id })
    }

    @Test
    fun testsAndDeliverables_splitByKind() {
        assertEquals(listOf("orMidterm", "cancelledRec", "sweQuiz"), ScheduleView.filter(items, ScheduleFilter.TESTS, now, zone, mine).map { it.id })
        assertEquals(listOf("lateReport", "mgAssign", "sweFco"), ScheduleView.filter(items, ScheduleFilter.DELIVERABLES, now, zone, mine).map { it.id })
    }

    @Test
    fun done_isWhatIMarkedDone_plusCancelled_newestFirst() {
        assertEquals(listOf("mgAssign", "cancelledRec"), ScheduleView.filter(items, ScheduleFilter.DONE, now, zone, mine).map { it.id })
    }

    @Test
    fun all_isEverything_soonestFirst() {
        assertEquals(6, ScheduleView.filter(items, ScheduleFilter.ALL, now, zone, mine).size)
        assertEquals("lateReport", ScheduleView.filter(items, ScheduleFilter.ALL, now, zone, mine).first().id)
    }

    @Test
    fun onDay_listsThatDaysItems() {
        assertEquals(setOf("sweQuiz", "mgAssign"), ScheduleView.onDay(items, LocalDate.of(2026, 10, 22), zone).map { it.id }.toSet())
    }

    @Test
    fun weekOf_runsSundayToSaturday() {
        val week = ScheduleView.weekOf(LocalDate.of(2026, 10, 21))
        assertEquals(7, week.size)
        assertEquals(LocalDate.of(2026, 10, 18), week.first())
        assertEquals(DayOfWeek.SUNDAY, week.first().dayOfWeek)
        assertEquals(LocalDate.of(2026, 10, 24), week.last())
        assertEquals(LocalDate.of(2026, 10, 18), ScheduleView.weekOf(LocalDate.of(2026, 10, 18)).first())
    }

    @Test
    fun monthGrid_startsOnSunday_andFillsWholeWeeks() {
        // October 2026 starts on a Thursday: four blank cells, then the 1st to the 31st, 35 cells in all.
        val october = ScheduleView.monthGrid(YearMonth.of(2026, 10))
        assertEquals(35, october.size)
        assertEquals(listOf(null, null, null, null, LocalDate.of(2026, 10, 1)), october.take(5))
        assertEquals(LocalDate.of(2026, 10, 31), october.last())
        // February 2026 starts on a Sunday and has 28 days: exactly four full weeks, no blanks.
        val february = ScheduleView.monthGrid(YearMonth.of(2026, 2))
        assertEquals(28, february.size)
        assertEquals(LocalDate.of(2026, 2, 1), february.first())
        assertTrue(february.all { it != null })
        // November 2026 starts on a Sunday and has 30 days: blanks only at the end.
        val november = ScheduleView.monthGrid(YearMonth.of(2026, 11))
        assertEquals(35, november.size)
        assertEquals(LocalDate.of(2026, 11, 30), november[29])
        assertNull(november.last())
    }

    @Test
    fun openByDay_skipsWhatIFinished_andCancelledItems() {
        val counts = ScheduleView.openByDay(items, zone, mine)
        assertEquals(1, counts[LocalDate.of(2026, 10, 22)])
        assertNull(counts[LocalDate.of(2026, 10, 21)])
    }

    @Test
    fun openKindsByDay_listsEachOpenItemsKind_mostImportantFirst() {
        val day = LocalDate.of(2026, 10, 23)
        val busy = listOf(
            item("d1", ScheduleKind.DEADLINE, 23),
            item("q1", ScheduleKind.QUIZ, 23),
            item("e1", ScheduleKind.EXAM, 23),
            item("f1", ScheduleKind.FCO, 23),
            item("doneExam", ScheduleKind.EXAM, 23),
            item("cancelled", ScheduleKind.RECITATION, 23, ScheduleStatus.CANCELLED),
        )
        val kinds = ScheduleView.openKindsByDay(busy, zone, doneIds = setOf("doneExam"))
        assertEquals(listOf(ScheduleKind.EXAM, ScheduleKind.FCO, ScheduleKind.QUIZ, ScheduleKind.DEADLINE), kinds[day])
    }

    @Test
    fun openKindsByDay_leavesOutDaysWithNothingOpen() {
        val kinds = ScheduleView.openKindsByDay(items, zone, mine)
        assertNull(kinds[LocalDate.of(2026, 10, 21)])
        assertEquals(listOf(ScheduleKind.QUIZ), kinds[LocalDate.of(2026, 10, 22)])
    }

    @Test
    fun dueLabel_readsNaturally() {
        val byId = items.associateBy { it.id }
        assertEquals("Tomorrow", ScheduleView.dueLabel(byId.getValue("orMidterm"), now, zone))
        assertEquals("In 3 days", ScheduleView.dueLabel(byId.getValue("sweQuiz"), now, zone))
        assertEquals("Overdue", ScheduleView.dueLabel(byId.getValue("lateReport"), now, zone))
        assertEquals("Done", ScheduleView.dueLabel(byId.getValue("lateReport"), now, zone, done = true))
        assertEquals("Cancelled", ScheduleView.dueLabel(byId.getValue("cancelledRec"), now, zone, done = true))
    }

    @Test
    fun isOverdue_onlyWhenOpenAndPast() {
        val byId = items.associateBy { it.id }
        assertTrue(ScheduleView.isOverdue(byId.getValue("lateReport"), now, zone))
        assertFalse(ScheduleView.isOverdue(byId.getValue("lateReport"), now, zone, done = true))
        assertFalse(ScheduleView.isOverdue(byId.getValue("orMidterm"), now, zone))
    }

    @Test
    fun completion_splitsTheClass_byWhoMarkedTheItemDone() {
        val members = listOf(Member(id = "u2", name = "Lito"), Member(id = "u1", name = "Ana"), Member(id = "u3", name = "Kim"))
        val progress = listOf(
            StudentProgress(id = "u1", done = mapOf("sweQuiz" to 1L, "mgAssign" to 2L)),
            StudentProgress(id = "u3", done = mapOf("mgAssign" to 3L)),
            StudentProgress(id = "someoneWhoLeft", done = mapOf("sweQuiz" to 4L)),
        )
        val summary = ScheduleView.completion("sweQuiz", members, progress)
        assertEquals(listOf("Ana"), summary.done.map { it.name })
        assertEquals(listOf("Kim", "Lito"), summary.notDone.map { it.name })
        assertEquals(3, summary.total)
    }

    @Test
    fun form_needsAShortTitle() {
        assertNotNull(ScheduleForms.check("  "))
        assertNotNull(ScheduleForms.check("x".repeat(81)))
        assertNull(ScheduleForms.check("Midterm Exam"))
    }
}

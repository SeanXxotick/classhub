package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleKind
import com.seanxxotick.classhub.data.model.StudentProgress
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

enum class ScheduleFilter(val label: String) {
    UPCOMING("Upcoming"),
    OVERDUE("Overdue"),
    TESTS("Quizzes and exams"),
    DELIVERABLES("Deliverables"),
    DONE("Done"),
    ALL("All"),
}

/** Who has and has not marked an item done, for officers who manage the schedule. */
data class CompletionSummary(val done: List<Member>, val notDone: List<Member>) {
    val total: Int get() = done.size + notDone.size
}

object ScheduleView {
    private val TEST_KINDS = setOf(ScheduleKind.QUIZ, ScheduleKind.EXAM, ScheduleKind.RECITATION)
    private val DELIVERABLE_KINDS = setOf(ScheduleKind.DEADLINE, ScheduleKind.FCO)

    /**
     * Applies a filter chip for the signed-in student ([doneIds] are the items they marked done).
     * Done lists their finished items and cancelled ones, newest first; everything else is soonest first.
     */
    fun filter(
        items: List<ScheduleItem>,
        filter: ScheduleFilter,
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        doneIds: Set<String> = emptySet(),
    ): List<ScheduleItem> = when (filter) {
        ScheduleFilter.UPCOMING -> ScheduleLogic.upcoming(items, nowMillis, zone, doneIds)
        ScheduleFilter.OVERDUE -> ScheduleLogic.overdue(items, nowMillis, zone, doneIds)
        ScheduleFilter.TESTS -> items.filter { it.kind in TEST_KINDS }.sortedBy { it.dueMillis }
        ScheduleFilter.DELIVERABLES -> items.filter { it.kind in DELIVERABLE_KINDS }.sortedBy { it.dueMillis }
        ScheduleFilter.DONE -> items.filter { !ScheduleLogic.isOpen(it, doneIds) }.sortedByDescending { it.dueMillis }
        ScheduleFilter.ALL -> items.sortedBy { it.dueMillis }
    }

    /** Items due on [day]. */
    fun onDay(items: List<ScheduleItem>, day: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<ScheduleItem> =
        items.filter { ScheduleLogic.dateOf(it.dueMillis, zone) == day }.sortedBy { it.dueMillis }

    /** The Sunday-to-Saturday week containing [day]. */
    fun weekOf(day: LocalDate): List<LocalDate> {
        val sunday = day.with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))
        return (0L..6L).map { sunday.plusDays(it) }
    }

    /** How many items this student still has open on each day, for the dots on the week strip. */
    fun openByDay(items: List<ScheduleItem>, zone: ZoneId = ZoneId.systemDefault(), doneIds: Set<String> = emptySet()): Map<LocalDate, Int> =
        items.filter { ScheduleLogic.isOpen(it, doneIds) }
            .groupingBy { ScheduleLogic.dateOf(it.dueMillis, zone) }
            .eachCount()

    /** The tag shown on an item: "Cancelled", "Done", "Overdue", "Today", "Tomorrow" or "In 5 days". */
    fun dueLabel(item: ScheduleItem, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault(), done: Boolean = false): String = when {
        ScheduleLogic.isCancelled(item) -> "Cancelled"
        done -> "Done"
        else -> {
            val days = ScheduleLogic.daysUntil(item.dueMillis, nowMillis, zone)
            if (days < 0) "Overdue" else ScheduleLogic.relativeLabel(days)
        }
    }

    fun isOverdue(item: ScheduleItem, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault(), done: Boolean = false): Boolean =
        !done && !ScheduleLogic.isCancelled(item) && ScheduleLogic.daysUntil(item.dueMillis, nowMillis, zone) < 0

    /** Splits the class into who marked [itemId] done and who has not, each sorted by name. */
    fun completion(itemId: String, members: List<Member>, progress: List<StudentProgress>): CompletionSummary {
        val doneUids = progress.filter { itemId in it.done }.map { it.id }.toSet()
        val (done, notDone) = members.sortedBy { it.name.lowercase() }.partition { it.id in doneUids }
        return CompletionSummary(done, notDone)
    }
}

object ScheduleForms {
    const val MAX_TITLE = 80

    fun check(title: String): String? = when {
        title.isBlank() -> "Give it a title, for example \"Midterm Exam\" or \"Assignment #3\"."
        title.trim().length > MAX_TITLE -> "Keep the title under $MAX_TITLE characters."
        else -> null
    }
}

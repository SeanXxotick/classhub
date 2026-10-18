package com.seanxxotick.classhub.data.model

/** Group 1 and Group 2 keep separate funds, as in the class spreadsheet. */
const val GROUP_1 = 1
const val GROUP_2 = 2

enum class Role { TREASURER, MEMBER }

/**
 * PAYMENT    a member pays money in (member balance +, cash +)
 * CHARGE     a per-member deduction such as a quiz fee (member balance -, cash unchanged)
 * WITHDRAWAL a member takes part of their balance out (member balance -, cash -)
 * EXPENSE    the class pays for something, no member involved (cash -)
 */
enum class RecordType { PAYMENT, CHARGE, WITHDRAWAL, EXPENSE }

enum class ScheduleKind { DEADLINE, QUIZ, EXAM, RECITATION, FCO }

enum class ScheduleStatus { PENDING, SUBMITTED, CANCELLED }

/** Firestore: users/{uid}. Every new account starts as a MEMBER; the treasurer is set by hand in the console. */
data class AppUser(
    val uid: String = "",
    val email: String = "",
    val role: Role = Role.MEMBER,
)

/** Firestore: courses/{id}. A subject the class takes, used to decide who a charge applies to. */
data class Course(
    val id: String = "",
    val name: String = "",
)

/**
 * Firestore: members/{id}
 *
 * [excludedCourseIds] lists the courses this member does NOT take, so a newly added
 * course includes everyone by default and only the exceptions are marked.
 */
data class Member(
    val id: String = "",
    val name: String = "",
    val group: Int = GROUP_1,
    val excludedCourseIds: List<String> = emptyList(),
)

/**
 * Firestore: records/{id}
 *
 * Money is stored as whole centavos (Long) so balances never drift.
 * [memberId] is empty for an EXPENSE. A charge to many members creates one record per member,
 * all sharing the same [batchId] so the whole charge can be undone together.
 */
data class LedgerRecord(
    val id: String = "",
    val type: RecordType = RecordType.PAYMENT,
    val amountCentavos: Long = 0,
    val memberId: String = "",
    val memberName: String = "",
    val note: String = "",
    val dateMillis: Long = 0,
    val group: Int = GROUP_1,
    val batchId: String = "",
    val courseId: String = "",
)

/** Firestore: schedule/{id}. [group] 0 means the item applies to the whole class. */
data class ScheduleItem(
    val id: String = "",
    val course: String = "",
    val title: String = "",
    val kind: ScheduleKind = ScheduleKind.DEADLINE,
    val dueMillis: Long = 0,
    val status: ScheduleStatus = ScheduleStatus.PENDING,
    val group: Int = 0,
)

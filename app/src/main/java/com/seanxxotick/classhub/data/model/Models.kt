package com.seanxxotick.classhub.data.model

/*
 * Firestore note: avoid property names that start with "is" (Firestore would store them without the prefix),
 * and keep permission/role lists as plain strings so security rules can read them.
 */

/** Ids of the roles every new class starts with. */
const val ROLE_MAYOR = "mayor"
const val ROLE_TREASURER = "treasurer"
const val ROLE_SECRETARY = "secretary"
const val ROLE_MEMBER = "member"

/** What a role can be allowed to do. Everyone in a class can always view its content. */
enum class Permission {
    RECORDS_MANAGE,
    SCHEDULE_MANAGE,
    MEMBERS_MANAGE,
    ROLES_MANAGE,
    CLASS_SETTINGS,
    CONTENTS_MANAGE,
}

/** What a class content link points to. Only links are stored; files stay in Google Drive or elsewhere. */
enum class ContentKind { FILE, VIDEO, WEBSITE }

/**
 * PAYMENT    a member pays money in (member balance +, cash +)
 * CHARGE     a per-member deduction such as a quiz fee (member balance -, cash unchanged)
 * WITHDRAWAL a member takes part of their balance out (member balance -, cash -)
 * EXPENSE    the class pays for something, no member involved (cash -)
 *
 * On screen these read "Payment", "Charge students", "Withdrawal" and "Pay out from fund".
 */
enum class RecordType { PAYMENT, CHARGE, WITHDRAWAL, EXPENSE }

enum class ScheduleKind { DEADLINE, QUIZ, EXAM, RECITATION, FCO }

enum class ScheduleStatus { PENDING, SUBMITTED, CANCELLED }

/** Firestore: users/{uid} */
data class AppUser(
    val uid: String = "",
    val email: String = "",
    val displayName: String = "",
)

/** Firestore: users/{uid}/memberships/{classId}. The "My classes" list. */
data class ClassMembership(
    val classId: String = "",
    val className: String = "",
    val joinedAtMillis: Long = 0,
)

/** Firestore: classes/{classId}. Named ClassRoom because "class" is a Kotlin keyword. */
data class ClassRoom(
    val id: String = "",
    val name: String = "",
    val description: String = "",
    val ownerUid: String = "",
    val accentColor: String = "#0F766E",
    val inviteCode: String = "",
    val defaultRoleId: String = ROLE_MEMBER,
    val ledgerEnabled: Boolean = true,
    val scheduleEnabled: Boolean = true,
    val contentsEnabled: Boolean = true,
    val createdAtMillis: Long = 0,
)

/**
 * Firestore: classes/{classId}/roles/{roleId}
 *
 * [permissions] holds [Permission] names. A [locked] role (the Mayor) cannot be edited or deleted.
 */
data class Role(
    val id: String = "",
    val name: String = "",
    val colorHex: String = "#6B768A",
    val permissions: List<String> = emptyList(),
    val locked: Boolean = false,
)

/**
 * Firestore: classes/{classId}/members/{uid}
 *
 * [id] is the member's user id. [excludedCourseIds] lists the courses this member does NOT take,
 * so a newly added course includes everyone by default and only the exceptions are marked.
 */
data class Member(
    val id: String = "",
    val name: String = "",
    val roleId: String = ROLE_MEMBER,
    val joinedAtMillis: Long = 0,
    val excludedCourseIds: List<String> = emptyList(),
)

/** Firestore: classes/{classId}/courses/{id}. A subject the class takes. */
data class Course(
    val id: String = "",
    val name: String = "",
)

/**
 * Firestore: classes/{classId}/records/{id}
 *
 * Money is stored as whole centavos (Long) so balances never drift.
 * [memberId] is empty for an EXPENSE. Charging many members creates one record per member,
 * all sharing the same [batchId] so the whole charge can be undone together.
 * Every EXPENSE (pay-out) settles exactly one charge: [settlesBatchId] is that charge's batch id,
 * and its amount equals the charge's total. [paidTo] optionally names who received the money.
 */
data class LedgerRecord(
    val id: String = "",
    val type: RecordType = RecordType.PAYMENT,
    val amountCentavos: Long = 0,
    val memberId: String = "",
    val memberName: String = "",
    val note: String = "",
    val dateMillis: Long = 0,
    val batchId: String = "",
    val courseId: String = "",
    val createdByUid: String = "",
    val settlesBatchId: String = "",
    val paidTo: String = "",
)

/**
 * Firestore: classes/{classId}/contents/{id}
 *
 * A link to class material (a module PDF in Google Drive, a recorded discussion, a website).
 * [courseId] is empty for general class material that belongs to no single course.
 */
data class ContentItem(
    val id: String = "",
    val courseId: String = "",
    val title: String = "",
    val url: String = "",
    val kind: ContentKind = ContentKind.WEBSITE,
    val note: String = "",
    val createdByUid: String = "",
    val createdAtMillis: Long = 0,
)

/** Firestore: classes/{classId}/schedule/{id} */
data class ScheduleItem(
    val id: String = "",
    val course: String = "",
    val title: String = "",
    val kind: ScheduleKind = ScheduleKind.DEADLINE,
    val dueMillis: Long = 0,
    val status: ScheduleStatus = ScheduleStatus.PENDING,
    val createdByUid: String = "",
)

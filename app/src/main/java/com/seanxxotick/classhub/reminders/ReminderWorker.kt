package com.seanxxotick.classhub.reminders

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.ClassRoom
import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.Role
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.StudentProgress
import com.seanxxotick.classhub.domain.Ledger
import com.seanxxotick.classhub.domain.ReminderText
import com.seanxxotick.classhub.domain.Reminders
import com.seanxxotick.classhub.domain.can
import com.seanxxotick.classhub.settings.AppSettings
import kotlinx.coroutines.tasks.await

/**
 * Runs once a day in the background (and on demand from "Send a test reminder now").
 * For each of the signed-in user's classes it loads only what that user may read under
 * the security rules, asks [Reminders] what to say, and posts phone notifications.
 */
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        AppSettings.init(applicationContext)
        val user = FirebaseAuth.getInstance().currentUser ?: return Result.success()
        val isTest = inputData.getBoolean(KEY_TEST, false)
        val db = FirebaseFirestore.getInstance()
        val now = System.currentTimeMillis()

        val classIds = try {
            db.collection("users").document(user.uid).collection("memberships").get().await().documents.map { it.id }
        } catch (e: Exception) {
            return if (isTest) Result.failure() else Result.retry()
        }

        var posted = 0
        for (classId in classIds) {
            // One class failing (for example after being removed) must not stop the others.
            posted += runCatching { checkClass(db, user.uid, classId, now, isTest) }.getOrDefault(0)
        }

        if (isTest && posted == 0) {
            ReminderNotifier.post(
                applicationContext,
                ReminderNotifier.idFor("test", "all-clear"),
                ReminderText("ClassHub reminders are working", "You are all caught up. Nothing is due tomorrow and you do not owe anything."),
            )
        }
        return Result.success()
    }

    /** Returns how many notifications were posted for this class. */
    private suspend fun checkClass(db: FirebaseFirestore, uid: String, classId: String, now: Long, isTest: Boolean): Int {
        val classRef = db.collection("classes").document(classId)
        val meDoc = classRef.collection("members").document(uid).get().await()
        if (!meDoc.exists()) return 0
        val room = classRef.get().await().toObject(ClassRoom::class.java) ?: return 0
        val roleId = meDoc.getString("roleId").orEmpty()
        val role = classRef.collection("roles").document(roleId).get().await().toObject(Role::class.java)
        var posted = 0

        fun post(kind: String, text: ReminderText) {
            ReminderNotifier.post(applicationContext, ReminderNotifier.idFor(classId, kind), text)
            posted++
        }

        // Due tomorrow, skipping what this student already marked done.
        if (room.scheduleEnabled && AppSettings.remindDueTomorrow) {
            val items = classRef.collection("schedule").get().await().documents
                .mapNotNull { d -> d.toObject(ScheduleItem::class.java)?.copy(id = d.id) }
            val done = classRef.collection("progress").document(uid).get().await()
                .toObject(StudentProgress::class.java)?.done?.keys.orEmpty()
            val due = Reminders.dueTomorrow(items, done, now)
            if (due.isNotEmpty()) post("due", Reminders.dueTomorrowText(room.name, due))
        }

        // New class materials since the last check (a test looks back one day).
        if (room.contentsEnabled && AppSettings.remindNewContents) {
            val saved = AppSettings.lastContentCheck(classId)
            val since = if (isTest && saved == 0L) now - DAY_MILLIS else saved
            if (since > 0L) {
                val fresh = classRef.collection("contents").whereGreaterThan("createdAtMillis", since).get().await().documents
                    .mapNotNull { d -> d.toObject(ContentItem::class.java)?.copy(id = d.id) }
                val items = Reminders.newContents(fresh, since)
                if (items.isNotEmpty()) post("contents", Reminders.newContentsText(room.name, items))
            }
            if (!isTest) AppSettings.setLastContentCheck(classId, now)
        }

        if (room.ledgerEnabled) {
            // The student's own balance.
            if (AppSettings.remindOwing) {
                val mine = classRef.collection("records").whereEqualTo("memberId", uid).get().await().documents
                    .mapNotNull { d -> d.toObject(LedgerRecord::class.java) }
                val balance = mine.sumOf { Ledger.memberDelta(it) }
                val (lastAt, lastBalance) = AppSettings.lastOwingReminder(classId)
                if (balance < 0 && (isTest || Reminders.shouldRemindOwing(balance, lastAt, lastBalance, now))) {
                    post("owing", Reminders.owingText(room.name, balance))
                    if (!isTest) AppSettings.setLastOwingReminder(classId, now, balance)
                } else if (balance >= 0 && !isTest) {
                    // Settled: the next time they owe, remind them straight away.
                    AppSettings.setLastOwingReminder(classId, 0L, 0L)
                }
            }

            // Weekly summary for officers who manage the ledger.
            if (AppSettings.remindOwingSummary && role.can(Permission.RECORDS_MANAGE) &&
                (isTest || Reminders.shouldSendWeeklySummary(AppSettings.lastOwingSummary(classId), now))
            ) {
                val records = classRef.collection("records").get().await().documents
                    .mapNotNull { d -> d.toObject(LedgerRecord::class.java) }
                val members = classRef.collection("members").get().await().documents
                    .mapNotNull { d -> d.toObject(Member::class.java)?.copy(id = d.id) }
                val owing = Reminders.owingMembers(members, records)
                if (owing.isNotEmpty()) post("summary", Reminders.weeklySummaryText(room.name, owing))
                if (!isTest) AppSettings.setLastOwingSummary(classId, now)
            }
        }
        return posted
    }

    companion object {
        const val KEY_TEST = "test"
        private const val DAY_MILLIS = 24L * 60 * 60 * 1000
    }
}

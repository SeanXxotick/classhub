package com.seanxxotick.classhub.reminders

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.time.Duration
import java.time.LocalTime
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

object ReminderScheduler {
    private const val DAILY = "daily-class-reminders"
    private const val TEST = "test-class-reminder"
    private val EVENING: LocalTime = LocalTime.of(18, 0)

    private val needsInternet = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Schedules the daily check for around 6 PM. Keeps an existing schedule, so calling it on every launch is fine. */
    fun scheduleDaily(context: Context) {
        val now = ZonedDateTime.now()
        var next = now.with(EVENING)
        if (!next.isAfter(now)) next = next.plusDays(1)
        val request = PeriodicWorkRequestBuilder<ReminderWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(Duration.between(now, next))
            .setConstraints(needsInternet)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(DAILY, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Runs the check right away and always shows something, for trying reminders out (and for the demo). */
    fun sendTestNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<ReminderWorker>()
            .setInputData(workDataOf(ReminderWorker.KEY_TEST to true))
            .setConstraints(needsInternet)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(TEST, ExistingWorkPolicy.REPLACE, request)
    }
}

package com.seanxxotick.classhub.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/**
 * Per-device settings, saved on the phone: theme, which reminders to show, and the
 * bookkeeping the reminder worker needs (when it last checked each class).
 * Compose screens read the observable values directly, so a change updates the UI at once.
 */
object AppSettings {
    private const val FILE = "classhub_settings"
    private var prefs: SharedPreferences? = null

    var themeMode by mutableStateOf(ThemeMode.SYSTEM)
        private set
    var remindDueTomorrow by mutableStateOf(true)
        private set
    var remindNewContents by mutableStateOf(true)
        private set
    var remindOwing by mutableStateOf(true)
        private set
    var remindOwingSummary by mutableStateOf(true)
        private set

    /** Safe to call more than once; the reminder worker calls it too, since it may run without the app open. */
    @Synchronized
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        prefs = p
        themeMode = runCatching { ThemeMode.valueOf(p.getString("theme", ThemeMode.SYSTEM.name)!!) }.getOrDefault(ThemeMode.SYSTEM)
        remindDueTomorrow = p.getBoolean("remind_due", true)
        remindNewContents = p.getBoolean("remind_contents", true)
        remindOwing = p.getBoolean("remind_owing", true)
        remindOwingSummary = p.getBoolean("remind_summary", true)
    }

    private fun edit(block: SharedPreferences.Editor.() -> Unit) {
        prefs?.edit()?.apply(block)?.apply()
    }

    fun updateTheme(mode: ThemeMode) {
        themeMode = mode
        edit { putString("theme", mode.name) }
    }

    fun updateRemindDueTomorrow(on: Boolean) {
        remindDueTomorrow = on
        edit { putBoolean("remind_due", on) }
    }

    fun updateRemindNewContents(on: Boolean) {
        remindNewContents = on
        edit { putBoolean("remind_contents", on) }
    }

    fun updateRemindOwing(on: Boolean) {
        remindOwing = on
        edit { putBoolean("remind_owing", on) }
    }

    fun updateRemindOwingSummary(on: Boolean) {
        remindOwingSummary = on
        edit { putBoolean("remind_summary", on) }
    }

    // ---- Reminder bookkeeping, per class ----

    fun lastContentCheck(classId: String): Long = prefs?.getLong("contents_check_$classId", 0L) ?: 0L

    fun setLastContentCheck(classId: String, millis: Long) = edit { putLong("contents_check_$classId", millis) }

    fun lastOwingReminder(classId: String): Pair<Long, Long> =
        (prefs?.getLong("owing_at_$classId", 0L) ?: 0L) to (prefs?.getLong("owing_balance_$classId", 0L) ?: 0L)

    fun setLastOwingReminder(classId: String, millis: Long, balance: Long) = edit {
        putLong("owing_at_$classId", millis)
        putLong("owing_balance_$classId", balance)
    }

    fun lastOwingSummary(classId: String): Long = prefs?.getLong("summary_at_$classId", 0L) ?: 0L

    fun setLastOwingSummary(classId: String, millis: Long) = edit { putLong("summary_at_$classId", millis) }
}

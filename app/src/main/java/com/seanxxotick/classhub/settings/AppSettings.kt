package com.seanxxotick.classhub.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/**
 * Per-device settings, saved on the phone: theme, which reminders to show, each class's
 * personal settings, and the bookkeeping the reminder worker needs (when it last checked each class).
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
        // A copy: the set SharedPreferences returns must not be changed.
        pinnedClasses = p.getStringSet("pinned_classes", emptySet()).orEmpty().toSet()
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

    // ---- My settings for one class (this phone only; classmates never see them) ----

    // Values changed while the app is open, so screens that show them redraw at once.
    private val classValues = mutableStateMapOf<String, Any>()

    private fun classBool(key: String): Boolean = classValues[key] as? Boolean ?: prefs?.getBoolean(key, true) ?: true

    private fun putClassBool(key: String, on: Boolean) {
        classValues[key] = on
        edit { putBoolean(key, on) }
    }

    /** The Account switch for [kind], which covers every class. */
    fun remindOn(kind: ReminderKind): Boolean = when (kind) {
        ReminderKind.DUE -> remindDueTomorrow
        ReminderKind.CONTENTS -> remindNewContents
        ReminderKind.OWING -> remindOwing
        ReminderKind.SUMMARY -> remindOwingSummary
    }

    /** The class's own switch for all its notifications. */
    fun classNotificationsOn(classId: String): Boolean = classBool("class_notify_$classId")

    fun setClassNotificationsOn(classId: String, on: Boolean) = putClassBool("class_notify_$classId", on)

    /** The class's own switch for one kind of reminder. */
    fun classReminderOn(classId: String, kind: ReminderKind): Boolean = classBool("class_remind_${kind.key}_$classId")

    fun setClassReminderOn(classId: String, kind: ReminderKind, on: Boolean) = putClassBool("class_remind_${kind.key}_$classId", on)

    /** Whether the reminder worker may post [kind] for this class: Account, the class's switch and its own switch all allow it. */
    fun shouldRemind(classId: String, kind: ReminderKind): Boolean =
        remindOn(kind) && classNotificationsOn(classId) && classReminderOn(classId, kind)

    /** The tab this class opens on (a tab name such as "SCHEDULE"), or null for Home. */
    fun startTab(classId: String): String? = classValues["class_tab_$classId"] as? String ?: prefs?.getString("class_tab_$classId", null)

    fun setStartTab(classId: String, tab: String) {
        classValues["class_tab_$classId"] = tab
        edit { putString("class_tab_$classId", tab) }
    }

    /** Classes pinned to the top of My classes. */
    var pinnedClasses by mutableStateOf<Set<String>>(emptySet())
        private set

    fun setPinned(classId: String, pinned: Boolean) {
        pinnedClasses = if (pinned) pinnedClasses + classId else pinnedClasses - classId
        edit { putStringSet("pinned_classes", pinnedClasses) }
    }
}

/** The kinds of reminder, for the per-class switches. [key] is how they are saved. */
enum class ReminderKind(val key: String) { DUE("due"), CONTENTS("contents"), OWING("owing"), SUMMARY("summary") }

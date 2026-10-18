package com.seanxxotick.classhub

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.seanxxotick.classhub.reminders.ReminderNotifier
import com.seanxxotick.classhub.reminders.ReminderScheduler
import com.seanxxotick.classhub.settings.AppSettings
import com.seanxxotick.classhub.ui.ClassHubApp

class MainActivity : ComponentActivity() {
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppSettings.init(this)
        ReminderNotifier.ensureChannel(this)
        ReminderScheduler.scheduleDaily(this)
        askForNotificationsOnce()
        enableEdgeToEdge()
        setContent { ClassHubApp() }
    }

    /** Android 13 and later need permission to show notifications. Ask once; the Account screen links to Settings after that. */
    private fun askForNotificationsOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("classhub_settings", MODE_PRIVATE)
        if (prefs.getBoolean("asked_notifications", false)) return
        prefs.edit().putBoolean("asked_notifications", true).apply()
        askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

package com.seanxxotick.classhub

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import com.seanxxotick.classhub.domain.JoinLinks
import com.seanxxotick.classhub.reminders.ReminderNotifier
import com.seanxxotick.classhub.reminders.ReminderScheduler
import com.seanxxotick.classhub.settings.AppSettings
import com.seanxxotick.classhub.ui.ClassHubApp

class MainActivity : ComponentActivity() {
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** An invite code from a join link, waiting to be shown on the Join screen. */
    private val pendingJoinCode = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppSettings.init(this)
        ReminderNotifier.ensureChannel(this)
        ReminderScheduler.scheduleDaily(this)
        askForNotificationsOnce()
        readJoinLink(intent)
        enableEdgeToEdge()
        setContent {
            ClassHubApp(pendingJoinCode = pendingJoinCode.value, onJoinCodeHandled = { pendingJoinCode.value = null })
        }
    }

    /** A join link tapped while ClassHub is already open. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readJoinLink(intent)
    }

    private fun readJoinLink(intent: Intent?) {
        intent?.data?.toString()?.let(JoinLinks::codeFrom)?.let { pendingJoinCode.value = it }
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

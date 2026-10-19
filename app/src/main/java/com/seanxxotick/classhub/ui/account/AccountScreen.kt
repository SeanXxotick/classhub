package com.seanxxotick.classhub.ui.account

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.seanxxotick.classhub.data.model.AppUser
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.seanxxotick.classhub.domain.NameRules
import com.seanxxotick.classhub.domain.PersonName
import com.seanxxotick.classhub.reminders.ReminderNotifier
import com.seanxxotick.classhub.reminders.ReminderScheduler
import com.seanxxotick.classhub.settings.AppSettings
import com.seanxxotick.classhub.settings.ThemeMode
import com.seanxxotick.classhub.ui.common.Avatar
import com.seanxxotick.classhub.ui.common.rememberPhotoPicker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    user: AppUser,
    photo: String?,
    busy: Boolean,
    notice: String?,
    onSetPhoto: (String) -> Unit,
    onRemovePhoto: () -> Unit,
    onPhotoError: (String) -> Unit,
    onClearNotice: () -> Unit,
    onSaveName: (PersonName, onSaved: () -> Unit) -> Unit,
    deleteStep: DeleteStep?,
    onStartDelete: () -> Unit,
    onCancelDelete: () -> Unit,
    onDeleteAccount: (password: String) -> Unit,
    onSignOut: () -> Unit,
    onChangePassword: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmSignOut by remember { mutableStateOf(false) }

    // Re-check whether notifications are allowed each time the screen comes back (for example after Settings).
    var resumeCount by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { resumeCount++ } }
    val notificationsAllowed = remember(resumeCount) { ReminderNotifier.canPost(context) }

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            message = null
        }
    }
    LaunchedEffect(notice) {
        notice?.let {
            snackbar.showSnackbar(it)
            onClearNotice()
        }
    }
    val pickPhoto = rememberPhotoPicker(onPicked = onSetPhoto, onError = onPhotoError)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Account", fontWeight = FontWeight.Bold) },
                navigationIcon = { TextButton(onClick = onBack) { Text("‹ Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(photo, user.displayName, MaterialTheme.colorScheme.primary, size = 64.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(user.displayName, fontWeight = FontWeight.Bold)
                        Text(user.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = pickPhoto, enabled = !busy) { Text(if (photo == null) "Add photo" else "Change photo") }
                            if (photo != null) {
                                TextButton(onClick = onRemovePhoto, enabled = !busy) { Text("Remove", color = MaterialTheme.colorScheme.error) }
                            }
                        }
                    }
                }
                Text(
                    "Your photo shows in every class you are in: on the member list, your member page and your ledger records.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                )
            }

            NameCard(user, busy, onSaveName)

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Appearance", fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(ThemeMode.SYSTEM to "Phone setting", ThemeMode.LIGHT to "Light", ThemeMode.DARK to "Dark").forEach { (mode, label) ->
                            FilterChip(selected = AppSettings.themeMode == mode, onClick = { AppSettings.updateTheme(mode) }, label = { Text(label) })
                        }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(vertical = 12.dp)) {
                    Text("Reminders", fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
                    Text(
                        "ClassHub checks your classes once a day, around 6 PM, and shows a phone notification when something needs your attention.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                    if (!notificationsAllowed) {
                        Text(
                            "Notifications are turned off for ClassHub, so reminders cannot appear.",
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                        TextButton(
                            onClick = {
                                val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                context.startActivity(intent)
                            },
                            modifier = Modifier.padding(horizontal = 8.dp),
                        ) { Text("Turn on notifications") }
                    }
                    ReminderSwitch("Due tomorrow", "Deadlines, quizzes and exams you have not marked done", AppSettings.remindDueTomorrow, AppSettings::updateRemindDueTomorrow)
                    ReminderSwitch("New class materials", "Links shared in Contents since the last check", AppSettings.remindNewContents, AppSettings::updateRemindNewContents)
                    ReminderSwitch("When I owe money", "At most once a week, or when the amount changes", AppSettings.remindOwing, AppSettings::updateRemindOwing)
                    ReminderSwitch("Who still owes (officers)", "A weekly summary for roles that manage the ledger", AppSettings.remindOwingSummary, AppSettings::updateRemindOwingSummary)
                    Button(
                        onClick = {
                            ReminderScheduler.sendTestNow(context)
                            message = if (notificationsAllowed) "Checking your classes now. A notification should appear in a few seconds."
                            else "Turn on notifications first, then try again."
                        },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    ) { Text("Send a test reminder now") }
                    Text(
                        "If reminders never arrive, allow ClassHub to run in the background in your phone's battery settings. Some phones stop apps from running in the background to save battery.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
            }

            OutlinedButton(onClick = onChangePassword, modifier = Modifier.fillMaxWidth()) { Text("Change password") }

            OutlinedButton(
                onClick = { confirmSignOut = true },
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Sign out") }

            TextButton(
                onClick = onStartDelete,
                enabled = !busy,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Delete account") }
        }
    }

    deleteStep?.let { DeleteAccountDialog(it, busy, onDeleteAccount, onCancelDelete) }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sign out?") },
            text = { Text("You can sign back in any time with your email and password. Reminders stop while you are signed out.") },
            confirmButton = { TextButton(onClick = { confirmSignOut = false; onSignOut() }) { Text("Sign out") } },
            dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel") } },
        )
    }
}

/** First name, middle initial and last name. Saving updates the name in every class the student is in. */
@Composable
private fun NameCard(user: AppUser, busy: Boolean, onSave: (PersonName, onSaved: () -> Unit) -> Unit) {
    // Older accounts only have one line; split it as a starting point the student can correct.
    val saved = remember(user) {
        if (user.firstName.isNotBlank() || user.lastName.isNotBlank()) PersonName(user.firstName, user.middleInitial, user.lastName)
        else NameRules.split(user.displayName)
    }
    var first by rememberSaveable(saved) { mutableStateOf(saved.first) }
    var initial by rememberSaveable(saved) { mutableStateOf(saved.middleInitial) }
    var last by rememberSaveable(saved) { mutableStateOf(saved.last) }
    val edited = PersonName(first, initial, last)
    val changed = NameRules.cleaned(edited) != NameRules.cleaned(saved)

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Your name", fontWeight = FontWeight.Bold)
            Text(
                "This is how your classmates and officers see you in every class.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = first,
                onValueChange = { first = it.take(NameRules.MAX_PART_LENGTH) },
                label = { Text("First name") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = initial,
                    onValueChange = { initial = NameRules.cleanInitial(it) },
                    label = { Text("M.I.") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next),
                    modifier = Modifier.width(84.dp),
                )
                OutlinedTextField(
                    value = last,
                    onValueChange = { last = it.take(NameRules.MAX_PART_LENGTH) },
                    label = { Text("Last name") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                    modifier = Modifier.weight(1f),
                )
            }
            if (changed) {
                Text(
                    "Shown as: ${NameRules.display(edited)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                    TextButton(onClick = { first = saved.first; initial = saved.middleInitial; last = saved.last }, enabled = !busy) { Text("Undo") }
                    Button(onClick = { onSave(edited) {} }, enabled = !busy) { Text("Save name") }
                }
            }
        }
    }
}

/** Checks for classes to hand over, then asks for the password before deleting everything. */
@Composable
private fun DeleteAccountDialog(step: DeleteStep, busy: Boolean, onDelete: (String) -> Unit, onCancel: () -> Unit) {
    when (step) {
        DeleteStep.Checking -> AlertDialog(
            onDismissRequest = onCancel,
            title = { Text("Delete account") },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Checking your classes.")
                }
            },
            confirmButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
        )
        is DeleteStep.MustHandOver -> AlertDialog(
            onDismissRequest = onCancel,
            title = { Text("Choose a new Mayor first") },
            text = {
                Text(
                    "You are the Mayor of ${step.classNames.joinToString(", ")}. A class always needs a Mayor, so open " +
                        (if (step.classNames.size == 1) "that class" else "each class") +
                        ", tap My settings at the top, and leave the class by making someone else the Mayor. Then come back here.",
                )
            },
            confirmButton = { TextButton(onClick = onCancel) { Text("OK") } },
        )
        is DeleteStep.Confirm -> {
            var password by rememberSaveable { mutableStateOf("") }
            AlertDialog(
                onDismissRequest = onCancel,
                title = { Text("Delete your account?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            "This cannot be undone. You will leave all your classes, and your name, photo and done marks will be erased. " +
                                "Ledger records with your name stay in each class, because they are part of the class fund's history.",
                        )
                        Text(
                            "If you still have money left in a class fund, or still owe money, settle it with your class officers first.",
                            fontWeight = FontWeight.SemiBold,
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Your password") },
                            singleLine = true,
                            enabled = !busy,
                            isError = step.error != null,
                            supportingText = step.error?.let { { Text(it) } },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = { onDelete(password) },
                        enabled = !busy,
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text(if (busy) "Deleting" else "Delete account") }
                },
                dismissButton = { TextButton(onClick = onCancel, enabled = !busy) { Text("Cancel") } },
            )
        }
    }
}

@Composable
private fun ReminderSwitch(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

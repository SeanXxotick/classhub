package com.seanxxotick.classhub.ui.classroom

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.domain.MemberRules
import com.seanxxotick.classhub.domain.Money
import com.seanxxotick.classhub.settings.AppSettings
import com.seanxxotick.classhub.settings.ReminderKind

/**
 * A member's own settings for one class: which notifications it sends, which tab it opens on,
 * and whether it is pinned in My classes (saved on this phone only; nobody else sees them).
 * Leaving the class is here too.
 */
@Composable
fun MySettingsScreen(
    state: ClassUiState,
    classId: String,
    myUid: String,
    busy: Boolean,
    notice: String?,
    onClearNotice: () -> Unit,
    onLeave: (newMayorUid: String?) -> Unit,
    onBack: () -> Unit,
) {
    var leaving by remember { mutableStateOf(false) }
    ManageScaffold("My settings", state, notice, onClearNotice, onBack) { padding ->
        val room = state.room ?: return@ManageScaffold
        val notifyOn = AppSettings.classNotificationsOn(classId)
        // Only the reminders this class can send to this member.
        val kinds = buildList {
            if (room.scheduleEnabled) add(ReminderKind.DUE)
            if (room.contentsEnabled) add(ReminderKind.CONTENTS)
            if (room.ledgerEnabled) add(ReminderKind.OWING)
            if (room.ledgerEnabled && state.can(Permission.RECORDS_MANAGE)) add(ReminderKind.SUMMARY)
        }
        val tabs = ClassTab.entries.filter { it.shownIn(room) }
        val startTab = AppSettings.startTab(classId)?.takeIf { name -> tabs.any { it.name == name } } ?: ClassTab.HOME.name

        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "These settings are only for you, on this phone. Nobody else in ${room.name} sees or changes them.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(vertical = 12.dp)) {
                    SectionTitle("Notifications")
                    SettingSwitch(
                        title = "Notifications from this class",
                        subtitle = if (notifyOn) "Turn off to mute every reminder from ${room.name}." else "Muted. You will not get any reminders from ${room.name}.",
                        checked = notifyOn,
                    ) { AppSettings.setClassNotificationsOn(classId, it) }
                    if (notifyOn) {
                        kinds.forEach { kind ->
                            val allowedEverywhere = AppSettings.remindOn(kind)
                            SettingSwitch(
                                title = kind.title(),
                                subtitle = if (allowedEverywhere) kind.subtitle() else "Turned off for all classes in Account.",
                                checked = allowedEverywhere && AppSettings.classReminderOn(classId, kind),
                                enabled = allowedEverywhere,
                                indent = true,
                            ) { AppSettings.setClassReminderOn(classId, kind, it) }
                        }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(vertical = 12.dp)) {
                    SectionTitle("Open this class on")
                    tabs.forEach { tab ->
                        Row(
                            Modifier.fillMaxWidth().clickable { AppSettings.setStartTab(classId, tab.name) }.padding(horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = tab.name == startTab, onClick = { AppSettings.setStartTab(classId, tab.name) })
                            Text(tab.label)
                        }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(vertical = 12.dp)) {
                    SectionTitle("My classes list")
                    val pinned = classId in AppSettings.pinnedClasses
                    SettingSwitch(
                        title = "Pin to the top",
                        subtitle = "Show ${room.name} first in My classes.",
                        checked = pinned,
                    ) { AppSettings.setPinned(classId, it) }
                }
            }

            OutlinedButton(
                onClick = { leaving = true },
                enabled = !busy,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Leave class") }
        }

        if (leaving) {
            if (MemberRules.mustHandOver(myUid, room.ownerUid)) {
                HandOverDialog(
                    className = room.name,
                    candidates = MemberRules.mayorCandidates(myUid, state.members),
                    onConfirm = { newMayor -> leaving = false; onLeave(newMayor.id) },
                    onDismiss = { leaving = false },
                )
            } else {
                val balance = if (room.ledgerEnabled) state.balanceOf(myUid) else 0L
                AlertDialog(
                    onDismissRequest = { leaving = false },
                    title = { Text("Leave ${room.name}?") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("The class will disappear from My classes. To come back, you will need a new invite code.")
                            Text("Your ledger records stay with the class, as part of its history.")
                            when {
                                balance < 0 -> Text(
                                    "You still owe ${Money.format(-balance)}. Please settle it with your class officers.",
                                    color = MaterialTheme.colorScheme.error,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                balance > 0 -> Text(
                                    "You have ${Money.format(balance)} left in the class fund. Ask your class officers about getting it back before you leave.",
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = { leaving = false; onLeave(null) }) { Text("Leave", color = MaterialTheme.colorScheme.error) }
                    },
                    dismissButton = { TextButton(onClick = { leaving = false }) { Text("Cancel") } },
                )
            }
        }
    }
}

/**
 * The Mayor picks who takes over, then confirms. Both happen in one step with leaving,
 * so the class is never without a Mayor.
 */
@Composable
private fun HandOverDialog(className: String, candidates: List<Member>, onConfirm: (Member) -> Unit, onDismiss: () -> Unit) {
    var chosenId by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }
    val chosen = candidates.firstOrNull { it.id == chosenId }

    when {
        candidates.isEmpty() -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("You cannot leave yet") },
            text = { Text("You are the only member of $className. Invite someone and make them the Mayor before you leave.") },
            confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        )
        confirming && chosen != null -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Make ${chosen.name} the Mayor and leave?") },
            text = {
                Text(
                    "${chosen.name} becomes the Mayor of $className, with every permission. " +
                        "You then leave the class. Only the new Mayor can undo this by inviting you back.",
                )
            },
            confirmButton = {
                TextButton(onClick = { onConfirm(chosen) }) { Text("Make Mayor and leave", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Back") } },
        )
        else -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Choose the new Mayor") },
            text = {
                Column {
                    Text(
                        "You are the Mayor, so someone has to take over before you leave.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    LazyColumn(Modifier.heightIn(max = 360.dp).padding(top = 8.dp)) {
                        items(candidates, key = { it.id }) { member ->
                            Row(
                                Modifier.fillMaxWidth().clickable { chosenId = member.id },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(selected = member.id == chosenId, onClick = { chosenId = member.id })
                                Text(member.name)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { confirming = true }, enabled = chosen != null) { Text("Next") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
    }
}

private fun ReminderKind.title(): String = when (this) {
    ReminderKind.DUE -> "Due tomorrow"
    ReminderKind.CONTENTS -> "New class materials"
    ReminderKind.OWING -> "When I owe money"
    ReminderKind.SUMMARY -> "Who still owes (officers)"
}

private fun ReminderKind.subtitle(): String = when (this) {
    ReminderKind.DUE -> "Deadlines, quizzes and exams you have not marked done"
    ReminderKind.CONTENTS -> "Links shared in Contents since the last check"
    ReminderKind.OWING -> "At most once a week, or when the amount changes"
    ReminderKind.SUMMARY -> "A weekly summary of who still owes"
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
}

@Composable
private fun SettingSwitch(
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean = true,
    indent: Boolean = false,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { onChange(!checked) }
            .padding(start = if (indent) 32.dp else 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            val color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
            Text(title, fontWeight = FontWeight.SemiBold, color = color)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

package com.seanxxotick.classhub.ui.classroom

import android.content.Intent
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.ExtendedFloatingActionButton
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.RecordType
import com.seanxxotick.classhub.domain.LedgerEntry
import com.seanxxotick.classhub.domain.LedgerView
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.StudentProgress
import com.seanxxotick.classhub.domain.ScheduleFilter
import com.seanxxotick.classhub.domain.ScheduleView
import com.seanxxotick.classhub.ui.contents.ContentsTab
import com.seanxxotick.classhub.ui.schedule.ScheduleRow
import com.seanxxotick.classhub.ui.schedule.ScheduleTab
import com.seanxxotick.classhub.ui.ledger.AddRecordChooser
import com.seanxxotick.classhub.ui.ledger.EntryRow
import com.seanxxotick.classhub.ui.ledger.FundSummaryCard
import com.seanxxotick.classhub.ui.ledger.LedgerTab
import com.seanxxotick.classhub.ui.ledger.balanceText
import com.seanxxotick.classhub.ui.common.Initials
import com.seanxxotick.classhub.ui.common.RoleChip
import com.seanxxotick.classhub.ui.common.initialsOf
import com.seanxxotick.classhub.ui.theme.ClassHubTheme
import com.seanxxotick.classhub.ui.theme.hexToColor

private enum class ClassTab(val label: String, val glyph: String) {
    HOME("Home", "⌂"),
    LEDGER("Ledger", "₱"),
    SCHEDULE("Schedule", "◷"),
    CONTENTS("Contents", "▤"),
    MEMBERS("Members", "≡"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassScreen(
    state: ClassUiState,
    myUid: String,
    busy: Boolean,
    notice: String?,
    onRegenerateCode: () -> Unit,
    onOpenMember: (String) -> Unit,
    onOpenRoles: () -> Unit,
    onOpenCourses: () -> Unit,
    onOpenSettings: () -> Unit,
    onAddRecord: (RecordType) -> Unit,
    onDeleteRecord: (LedgerRecord) -> Unit,
    onUndoCharge: (LedgerEntry.ChargeBatch) -> Unit,
    onRecordPayout: (String) -> Unit,
    onAddContent: () -> Unit,
    onEditContent: (String) -> Unit,
    onAddScheduleItem: (dayEpoch: Long?) -> Unit,
    onEditScheduleItem: (String) -> Unit,
    progress: List<StudentProgress>,
    onToggleDone: (ScheduleItem, Boolean) -> Unit,
    onSetCancelled: (ScheduleItem, Boolean) -> Unit,
    onShowNotice: (String) -> Unit,
    onClearNotice: () -> Unit,
    onRemoved: () -> Unit,
    onBack: () -> Unit,
) {
    LaunchedEffect(state.removed) { if (state.removed) onRemoved() }

    val room = state.room
    ClassHubTheme(accentHex = room?.accentColor) {
        var tabName by rememberSaveable { mutableStateOf(ClassTab.HOME.name) }
        // The day tapped in the schedule's week strip; adding a schedule item starts on it.
        var scheduleDay by rememberSaveable { mutableStateOf<Long?>(null) }
        val tabs = ClassTab.entries.filter {
            when (it) {
                ClassTab.LEDGER -> room?.ledgerEnabled != false
                ClassTab.SCHEDULE -> room?.scheduleEnabled != false
                ClassTab.CONTENTS -> room?.contentsEnabled != false
                else -> true
            }
        }
        val tab = tabs.firstOrNull { it.name == tabName } ?: ClassTab.HOME
        val snackbar = remember { SnackbarHostState() }
        var choosingRecord by remember { mutableStateOf(false) }
        LaunchedEffect(notice) {
            if (notice != null) {
                snackbar.showSnackbar(notice)
                onClearNotice()
            }
        }

        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(room?.name ?: "", fontWeight = FontWeight.Bold) },
                    navigationIcon = { TextButton(onClick = onBack) { Text("‹ Classes") } },
                )
            },
            bottomBar = {
                NavigationBar {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = t == tab,
                            onClick = { tabName = t.name },
                            icon = { Text(t.glyph, fontSize = 20.sp) },
                            label = { Text(t.label) },
                        )
                    }
                }
            },
            snackbarHost = { SnackbarHost(snackbar) },
            floatingActionButton = {
                if (tab == ClassTab.LEDGER && state.can(Permission.RECORDS_MANAGE)) {
                    ExtendedFloatingActionButton(onClick = { choosingRecord = true }) { Text("+  New record") }
                }
                if (tab == ClassTab.SCHEDULE && state.can(Permission.SCHEDULE_MANAGE)) {
                    ExtendedFloatingActionButton(onClick = { onAddScheduleItem(scheduleDay) }) {
                        Text(scheduleDay?.let { "+  Add on " + LocalDate.ofEpochDay(it).format(DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())) } ?: "+  Add")
                    }
                }
                if (tab == ClassTab.CONTENTS && state.can(Permission.CONTENTS_MANAGE)) {
                    ExtendedFloatingActionButton(onClick = onAddContent) { Text("+  Add content") }
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when {
                    state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    state.error != null -> Text(
                        state.error,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                    )
                    room == null || state.me == null -> Unit
                    else -> when (tab) {
                        ClassTab.HOME -> HomeTab(
                            state, myUid, busy, onRegenerateCode, onOpenRoles, onOpenCourses, onOpenSettings,
                            onSeeLedger = { tabName = ClassTab.LEDGER.name },
                            onSeeSchedule = { tabName = ClassTab.SCHEDULE.name },
                            onToggleDone = onToggleDone,
                        )
                        ClassTab.MEMBERS -> MembersTab(state, myUid, onOpenMember)
                        ClassTab.LEDGER -> LedgerTab(state, myUid, onDeleteRecord, onUndoCharge, onRecordPayout)
                        ClassTab.SCHEDULE -> ScheduleTab(
                            state = state,
                            progress = progress,
                            selectedEpochDay = scheduleDay,
                            onSelectDay = { scheduleDay = it },
                            onEdit = onEditScheduleItem,
                            onToggleDone = onToggleDone,
                            onSetCancelled = onSetCancelled,
                        )
                        ClassTab.CONTENTS -> ContentsTab(state, onEdit = onEditContent, onError = onShowNotice)
                    }
                }
            }
        }

        if (choosingRecord) {
            AddRecordChooser(
                onPick = { type -> choosingRecord = false; onAddRecord(type) },
                onDismiss = { choosingRecord = false },
            )
        }
    }
}

@Composable
private fun HomeTab(
    state: ClassUiState,
    myUid: String,
    busy: Boolean,
    onRegenerateCode: () -> Unit,
    onOpenRoles: () -> Unit,
    onOpenCourses: () -> Unit,
    onOpenSettings: () -> Unit,
    onSeeLedger: () -> Unit,
    onSeeSchedule: () -> Unit,
    onToggleDone: (ScheduleItem, Boolean) -> Unit,
) {
    val room = state.room ?: return
    val myRole = state.myRole
    var confirmNewCode by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(18.dp)) {
                    Text(room.name, color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    if (room.description.isNotBlank()) {
                        Text(room.description, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f))
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "${state.members.size} member${if (state.members.size == 1) "" else "s"}  ·  You are ${myRole?.name ?: "a member"}",
                        color = MaterialTheme.colorScheme.onPrimary,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        if (room.scheduleEnabled) {
            item {
                val now = System.currentTimeMillis()
                val upcoming = ScheduleView.filter(state.schedule, ScheduleFilter.UPCOMING, now, doneIds = state.myDone).take(3)
                val overdue = ScheduleView.filter(state.schedule, ScheduleFilter.OVERDUE, now, doneIds = state.myDone).size
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(vertical = 12.dp)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Coming up", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                                if (overdue > 0) {
                                    Text(
                                        "$overdue overdue item${if (overdue == 1) "" else "s"}",
                                        color = MaterialTheme.colorScheme.error,
                                        style = MaterialTheme.typography.bodySmall,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                }
                            }
                            TextButton(onClick = onSeeSchedule) { Text("Schedule ›") }
                        }
                        if (upcoming.isEmpty()) {
                            Text(
                                "Nothing due soon. You are all caught up.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                            )
                        }
                        upcoming.forEach { ScheduleRow(it, state, now, showDate = true, onToggleDone = onToggleDone) }
                    }
                }
            }
        }

        if (room.ledgerEnabled) {
            item { FundSummaryCard(state.records) }
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(vertical = 12.dp)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Your balance", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(balanceText(state.balanceOf(myUid)), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            }
                            TextButton(onClick = onSeeLedger) { Text("Ledger ›") }
                        }
                        val recent = LedgerView.entries(state.records).take(3)
                        if (recent.isNotEmpty()) {
                            Text(
                                "RECENT",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 16.dp, top = 8.dp),
                            )
                            recent.forEach { EntryRow(it, state) }
                        }
                    }
                }
            }
        }

        if (state.can(Permission.MEMBERS_MANAGE)) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Invite students", fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth())
                        Text(
                            "Share this code. Students enter it under \"Join with a code\" and join as ${state.roles.firstOrNull { it.id == room.defaultRoleId }?.name ?: "Member"}.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            room.inviteCode,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 32.sp,
                            letterSpacing = 6.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, "Join ${room.name} on ClassHub with the invite code ${room.inviteCode}")
                                }
                                context.startActivity(Intent.createChooser(send, "Share invite code"))
                            }) { Text("Share code") }
                            OutlinedButton(onClick = { confirmNewCode = true }, enabled = !busy) { Text("New code") }
                        }
                    }
                }
            }
        }

        val canRoles = state.can(Permission.ROLES_MANAGE)
        val canCourses = state.can(Permission.CLASS_SETTINGS)
        if (canRoles || canCourses) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        Text("Manage", fontWeight = FontWeight.Bold)
                        Text(
                            "Officer roles, the courses your class takes, and class settings.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (canRoles) OutlinedButton(onClick = onOpenRoles) { Text("Roles (${state.roles.size})") }
                            if (canCourses) OutlinedButton(onClick = onOpenCourses) { Text("Courses (${state.courses.size})") }
                        }
                        if (canCourses) {
                            OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth()) { Text("Class settings") }
                        }
                    }
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text("What you can do", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    PermissionLine("Manage ledger records", state.can(Permission.RECORDS_MANAGE))
                    PermissionLine("Manage schedule", state.can(Permission.SCHEDULE_MANAGE))
                    PermissionLine("Manage members", state.can(Permission.MEMBERS_MANAGE))
                    PermissionLine("Manage roles", state.can(Permission.ROLES_MANAGE))
                    PermissionLine("Change class settings", state.can(Permission.CLASS_SETTINGS))
                    PermissionLine("Manage class contents", state.can(Permission.CONTENTS_MANAGE))
                }
            }
        }
    }

    if (confirmNewCode) {
        AlertDialog(
            onDismissRequest = { confirmNewCode = false },
            title = { Text("Make a new invite code?") },
            text = { Text("The current code ${room.inviteCode} will stop working. People already in the class stay.") },
            confirmButton = { TextButton(onClick = { confirmNewCode = false; onRegenerateCode() }) { Text("Make new code") } },
            dismissButton = { TextButton(onClick = { confirmNewCode = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PermissionLine(label: String, allowed: Boolean) {
    Row(Modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (allowed) "✓" else "–",
            color = if (allowed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.width(22.dp),
        )
        Text(label, color = if (allowed) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MembersTab(state: ClassUiState, myUid: String, onOpenMember: (String) -> Unit) {
    val canManage = state.can(Permission.MEMBERS_MANAGE)
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        item {
            Text(
                "${state.members.size} member${if (state.members.size == 1) "" else "s"}" +
                    if (canManage) "  ·  Tap someone to set their role or courses" else "",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        items(state.members, key = { it.id }) { member ->
            MemberRow(member, state, isMe = member.id == myUid, onClick = if (canManage) ({ onOpenMember(member.id) }) else null)
        }
    }
}

@Composable
private fun MemberRow(member: Member, state: ClassUiState, isMe: Boolean, onClick: (() -> Unit)?) {
    val role = state.roleOf(member)
    val skipped = state.courses.count { it.id in member.excludedCourseIds }
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Initials(initialsOf(member.name), hexToColor(role?.colorHex ?: "#6B768A"), circle = true)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(if (isMe) "${member.name} (you)" else member.name, fontWeight = FontWeight.SemiBold)
            val details = listOfNotNull(
                if (state.room?.ledgerEnabled != false) balanceText(state.balanceOf(member.id)) else null,
                if (skipped > 0) "Does not take $skipped course${if (skipped == 1) "" else "s"}" else null,
            )
            if (details.isNotEmpty()) {
                Text(
                    details.joinToString("  ·  "),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state.balanceOf(member.id) < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        RoleChip(role?.name ?: "No role", role?.colorHex ?: "#6B768A")
    }
}

@Composable
private fun ComingSoon(title: String, body: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(body, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Text("Coming in the next build.", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
    }
}

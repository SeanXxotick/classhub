package com.seanxxotick.classhub.ui.classroom

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role as SemanticsRole
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.data.model.Course
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.Role
import com.seanxxotick.classhub.domain.CourseRules
import com.seanxxotick.classhub.domain.LedgerEntry
import com.seanxxotick.classhub.domain.LedgerView
import com.seanxxotick.classhub.ui.ledger.EntryRow
import com.seanxxotick.classhub.ui.ledger.balanceText
import com.seanxxotick.classhub.domain.MemberRules
import com.seanxxotick.classhub.domain.RoleRules
import com.seanxxotick.classhub.ui.common.AccentPicker
import com.seanxxotick.classhub.ui.common.Initials
import com.seanxxotick.classhub.ui.common.RoleChip
import com.seanxxotick.classhub.ui.common.initialsOf
import com.seanxxotick.classhub.ui.theme.ClassHubTheme
import com.seanxxotick.classhub.ui.theme.RoleColorChoices
import com.seanxxotick.classhub.ui.theme.hexToColor

/** Title and explanation shown for each permission switch. */
internal fun Permission.label(): Pair<String, String> = when (this) {
    Permission.RECORDS_MANAGE -> "Manage ledger records" to "Payments, charging students, withdrawals and pay-outs"
    Permission.SCHEDULE_MANAGE -> "Manage schedule" to "Deadlines, quizzes and exams"
    Permission.MEMBERS_MANAGE -> "Manage members" to "Assign roles, set courses, remove members, invite code"
    Permission.ROLES_MANAGE -> "Manage roles" to "Create, edit and delete roles"
    Permission.CLASS_SETTINGS -> "Class settings and courses" to "Name, color, modules and the course list"
    Permission.CONTENTS_MANAGE -> "Manage class contents" to "Add, edit and remove links to files, videos and websites"
}

/** Shared frame for the management screens: class accent, back button, snackbar for notices. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManageScaffold(
    title: String,
    state: ClassUiState,
    notice: String?,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
    actions: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    ClassHubTheme(accentHex = state.room?.accentColor) {
        val snackbar = remember { SnackbarHostState() }
        LaunchedEffect(notice) {
            if (notice != null) {
                snackbar.showSnackbar(notice)
                onClearNotice()
            }
        }
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(title, fontWeight = FontWeight.Bold) },
                    navigationIcon = { TextButton(onClick = onBack) { Text("‹ Back") } },
                    actions = { actions() },
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            when {
                state.loading -> Box(Modifier.fillMaxSize().padding(padding)) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                else -> content(padding)
            }
        }
    }
}

@Composable
private fun NoAccess(padding: PaddingValues, what: String) {
    Box(Modifier.fillMaxSize().padding(padding).padding(32.dp), contentAlignment = Alignment.Center) {
        Text("Your role does not allow you to $what.", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun ColorDot(hex: String) {
    Box(Modifier.size(14.dp).clip(CircleShape).background(hexToColor(hex)))
}

// ---------------------------------------------------------------- Member detail

@Composable
fun MemberDetailScreen(
    state: ClassUiState,
    memberId: String,
    myUid: String,
    busy: Boolean,
    notice: String?,
    onSaveRole: (Member, String) -> Unit,
    onSaveCourses: (Member, Set<String>) -> Unit,
    onRemove: (Member) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    val member = state.members.firstOrNull { it.id == memberId }
    ManageScaffold(member?.name ?: "Member", state, notice, onClearNotice, onBack) { padding ->
        when {
            member == null -> NoAccess(padding, "see this member, or they are no longer in the class")
            !state.can(Permission.MEMBERS_MANAGE) -> NoAccess(padding, "manage members")
            else -> MemberDetailContent(state, member, myUid, busy, padding, onSaveRole, onSaveCourses, onRemove)
        }
    }
}

@Composable
private fun MemberDetailContent(
    state: ClassUiState,
    member: Member,
    myUid: String,
    busy: Boolean,
    padding: PaddingValues,
    onSaveRole: (Member, String) -> Unit,
    onSaveCourses: (Member, Set<String>) -> Unit,
    onRemove: (Member) -> Unit,
) {
    val ownerUid = state.room?.ownerUid.orEmpty()
    val canChangeRole = MemberRules.canChangeRole(myUid, member, ownerUid)
    val canRemove = MemberRules.canRemove(myUid, member, ownerUid)
    val currentRole = state.roleOf(member)

    var selectedRoleId by rememberSaveable(member.id, member.roleId) { mutableStateOf(member.roleId) }
    var taken by remember(member.id, member.excludedCourseIds, state.courses) {
        mutableStateOf(state.courses.map { it.id }.filterNot { it in member.excludedCourseIds }.toSet())
    }
    val coursesChanged = taken != state.courses.map { it.id }.filterNot { it in member.excludedCourseIds }.toSet()
    var confirmRemove by remember { mutableStateOf(false) }

    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Initials(initialsOf(member.name), hexToColor(currentRole?.colorHex ?: "#6B768A"), circle = true)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (member.id == myUid) "${member.name} (you)" else member.name, fontWeight = FontWeight.Bold)
                    Text("Current role", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                RoleChip(currentRole?.name ?: "No role", currentRole?.colorHex ?: "#6B768A")
            }
            HorizontalDivider()
        }

        // Balance
        if (state.room?.ledgerEnabled != false) {
            item { SectionLabel("Balance") }
            item {
                Text(
                    balanceText(state.balanceOf(member.id)),
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium,
                    color = if (state.balanceOf(member.id) < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            items(LedgerView.statement(member.id, state.records).take(5), key = { "st-" + it.id }) { record ->
                EntryRow(LedgerEntry.Single(record), state)
            }
        }

        // Role
        item { SectionLabel("Role") }
        if (!canChangeRole) {
            item {
                Text(
                    if (member.id == ownerUid) "The Mayor's role cannot be changed." else "You cannot change your own role.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
        } else {
            items(MemberRules.assignableRoles(state.roles), key = { "role-" + it.id }) { role ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .selectable(selected = role.id == selectedRoleId, onClick = { selectedRoleId = role.id }, role = SemanticsRole.RadioButton)
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = role.id == selectedRoleId, onClick = null)
                    Spacer(Modifier.width(8.dp))
                    ColorDot(role.colorHex)
                    Spacer(Modifier.width(10.dp))
                    Text(role.name, modifier = Modifier.weight(1f))
                }
            }
            item {
                Button(
                    onClick = { onSaveRole(member, selectedRoleId) },
                    enabled = !busy && selectedRoleId != member.roleId,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) { Text("Save role") }
            }
        }

        // Courses
        item { SectionLabel("Courses taken") }
        if (state.courses.isEmpty()) {
            item {
                Text(
                    "This class has no courses yet. Add them under Home → Courses.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
        } else {
            items(state.courses, key = { "course-" + it.id }) { course ->
                val takes = course.id in taken
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { taken = if (takes) taken - course.id else taken + course.id }
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(course.name)
                        if (!takes) {
                            Text("Skipped when charging this course", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Switch(checked = takes, onCheckedChange = { on -> taken = if (on) taken + course.id else taken - course.id })
                }
            }
            item {
                Button(
                    onClick = { onSaveCourses(member, taken) },
                    enabled = !busy && coursesChanged,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) { Text("Save courses") }
            }
        }

        if (canRemove) {
            item {
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                OutlinedButton(
                    onClick = { confirmRemove = true },
                    enabled = !busy,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) { Text("Remove from class") }
            }
        }
    }

    if (confirmRemove) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = { Text("Remove ${member.name}?") },
            text = { Text("They lose access to this class. Their past ledger records stay. They can rejoin with the invite code.") },
            confirmButton = { TextButton(onClick = { confirmRemove = false; onRemove(member) }) { Text("Remove", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text("Cancel") } },
        )
    }
}

// ---------------------------------------------------------------- Roles list

@Composable
fun RolesScreen(
    state: ClassUiState,
    notice: String?,
    onOpenRole: (String) -> Unit,
    onNewRole: () -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    val canManage = state.can(Permission.ROLES_MANAGE)
    ManageScaffold(
        title = "Roles",
        state = state,
        notice = notice,
        onClearNotice = onClearNotice,
        onBack = onBack,
        actions = { if (canManage) TextButton(onClick = onNewRole) { Text("+ New role") } },
    ) { padding ->
        if (!canManage) {
            NoAccess(padding, "manage roles")
            return@ManageScaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(vertical = 8.dp)) {
            items(state.roles, key = { it.id }) { role ->
                val holders = MemberRules.holders(role, state.members)
                val summary = when {
                    role.locked -> "All permissions"
                    role.permissions.isEmpty() -> "View only"
                    else -> Permission.entries.filter { it.name in role.permissions }.joinToString { it.label().first.removePrefix("Manage ") }
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !role.locked) { onOpenRole(role.id) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ColorDot(role.colorHex)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(role.name, fontWeight = FontWeight.SemiBold)
                        Text(
                            "$summary · $holders member${if (holders == 1) "" else "s"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(if (role.locked) "Locked" else "›", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                Text(
                    "Tap a role to rename it, change its color or choose what it can do. New members join as ${state.roles.firstOrNull { it.id == state.room?.defaultRoleId }?.name ?: "Member"}.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
    }
}

// ---------------------------------------------------------------- Role editor

/** [roleId] is null when creating a new role. */
@Composable
fun RoleEditorScreen(
    state: ClassUiState,
    roleId: String?,
    busy: Boolean,
    notice: String?,
    onSave: (Role) -> Unit,
    onDelete: (Role) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    val existing = roleId?.let { id -> state.roles.firstOrNull { it.id == id } }
    val title = if (existing == null) "New role" else "Edit role"
    ManageScaffold(title, state, notice, onClearNotice, onBack) { padding ->
        when {
            !state.can(Permission.ROLES_MANAGE) -> NoAccess(padding, "manage roles")
            roleId != null && existing == null -> NoAccess(padding, "edit this role, or it was deleted")
            existing != null && !RoleRules.canEdit(existing) -> NoAccess(padding, "edit the ${existing.name} role")
            else -> RoleEditorContent(state, existing, busy, padding, onSave, onDelete)
        }
    }
}

@Composable
private fun RoleEditorContent(
    state: ClassUiState,
    existing: Role?,
    busy: Boolean,
    padding: PaddingValues,
    onSave: (Role) -> Unit,
    onDelete: (Role) -> Unit,
) {
    var name by rememberSaveable(existing?.id) { mutableStateOf(existing?.name.orEmpty()) }
    var color by rememberSaveable(existing?.id) { mutableStateOf(existing?.colorHex ?: RoleColorChoices.first()) }
    var permissions by remember(existing?.id) { mutableStateOf(existing?.permissions.orEmpty().toSet()) }
    var confirmDelete by remember { mutableStateOf(false) }
    val defaultRoleId = state.room?.defaultRoleId.orEmpty()
    val defaultRoleName = state.roles.firstOrNull { it.id == defaultRoleId }?.name ?: "Member"
    val nameOk = RoleRules.isNameValid(name, state.roles, existing?.id.orEmpty())

    LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(24) },
                    label = { Text("Role name") },
                    placeholder = { Text("e.g. PIO, Auditor, Class Rep") },
                    singleLine = true,
                    isError = name.isNotBlank() && !nameOk,
                    supportingText = { if (name.isNotBlank() && !nameOk) Text("Another role already uses this name.") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Color", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                AccentPicker(RoleColorChoices, color) { color = it }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Preview  ", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    RoleChip(name.ifBlank { "Role" }, color)
                }
            }
        }
        item { SectionLabel("Can do") }
        items(Permission.entries.toList(), key = { it.name }) { permission ->
            val (title, subtitle) = permission.label()
            val on = permission.name in permissions
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { permissions = if (on) permissions - permission.name else permissions + permission.name }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(title, fontWeight = FontWeight.SemiBold)
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = on, onCheckedChange = { checked ->
                    permissions = if (checked) permissions + permission.name else permissions - permission.name
                })
            }
        }
        item {
            Button(
                onClick = {
                    onSave(
                        Role(
                            id = existing?.id.orEmpty(),
                            name = name,
                            colorHex = color,
                            permissions = Permission.entries.map { it.name }.filter { it in permissions },
                        ),
                    )
                },
                enabled = !busy && nameOk,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) { Text(if (existing == null) "Create role" else "Save role") }
        }
        if (existing != null && RoleRules.canDelete(existing, defaultRoleId)) {
            item {
                OutlinedButton(
                    onClick = { confirmDelete = true },
                    enabled = !busy,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                ) { Text("Delete role") }
            }
        }
    }

    if (confirmDelete && existing != null) {
        val holders = MemberRules.holders(existing, state.members)
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete ${existing.name}?") },
            text = {
                Text(
                    if (holders == 0) "No one has this role."
                    else "$holders member${if (holders == 1) "" else "s"} with this role will become $defaultRoleName.",
                )
            },
            confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete(existing) }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

// ---------------------------------------------------------------- Courses

@Composable
fun CoursesScreen(
    state: ClassUiState,
    busy: Boolean,
    notice: String?,
    onAdd: (String, () -> Unit) -> Unit,
    onRename: (Course, String) -> Unit,
    onDelete: (Course) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    ManageScaffold("Courses", state, notice, onClearNotice, onBack) { padding ->
        if (!state.can(Permission.CLASS_SETTINGS)) {
            NoAccess(padding, "edit courses")
            return@ManageScaffold
        }
        var newName by rememberSaveable { mutableStateOf("") }
        var editing by remember { mutableStateOf<Course?>(null) }

        LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = newName,
                        onValueChange = { newName = it.take(CourseRules.MAX_NAME) },
                        label = { Text("New course") },
                        placeholder = { Text("e.g. Operations Research") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { onAdd(newName) { newName = "" } }, enabled = !busy && newName.isNotBlank()) { Text("Add") }
                }
            }
            if (state.courses.isEmpty()) {
                item {
                    Text(
                        "No courses yet. Add the subjects your class takes, then mark who does not take each one from their member page.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
            }
            items(state.courses, key = { it.id }) { course ->
                val takers = CourseRules.takers(course, state.members)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { editing = course }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Initials(initialsOf(course.name), MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(course.name, fontWeight = FontWeight.SemiBold)
                        Text(
                            "$takers of ${state.members.size} take this",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                Text(
                    "A new course includes everyone. Mark the students who do not take it on their member page, and charges by course will skip them.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }

        editing?.let { course ->
            var rename by remember(course.id) { mutableStateOf(course.name) }
            var confirmDelete by remember(course.id) { mutableStateOf(false) }
            if (!confirmDelete) {
                AlertDialog(
                    onDismissRequest = { editing = null },
                    title = { Text("Edit course") },
                    text = {
                        OutlinedTextField(
                            value = rename,
                            onValueChange = { rename = it.take(CourseRules.MAX_NAME) },
                            label = { Text("Course name") },
                            singleLine = true,
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { onRename(course, rename); editing = null }, enabled = rename.isNotBlank() && rename.trim() != course.name) { Text("Save") }
                    },
                    dismissButton = {
                        Row {
                            TextButton(onClick = { confirmDelete = true }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                            TextButton(onClick = { editing = null }) { Text("Cancel") }
                        }
                    },
                )
            } else {
                AlertDialog(
                    onDismissRequest = { editing = null },
                    title = { Text("Delete ${course.name}?") },
                    text = { Text("Past charges stay in the ledger. You will not be able to charge by this course anymore.") },
                    confirmButton = { TextButton(onClick = { onDelete(course); editing = null }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
                    dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
                )
            }
        }
    }
}

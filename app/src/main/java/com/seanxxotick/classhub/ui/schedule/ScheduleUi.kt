package com.seanxxotick.classhub.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleKind
import com.seanxxotick.classhub.data.model.ScheduleStatus
import com.seanxxotick.classhub.data.model.StudentProgress
import com.seanxxotick.classhub.domain.ScheduleFilter
import com.seanxxotick.classhub.domain.ScheduleForms
import com.seanxxotick.classhub.domain.ScheduleLogic
import com.seanxxotick.classhub.domain.ScheduleView
import com.seanxxotick.classhub.ui.classroom.ClassUiState
import com.seanxxotick.classhub.ui.classroom.ManageScaffold
import com.seanxxotick.classhub.ui.common.DateField
import com.seanxxotick.classhub.ui.common.PickerField
import com.seanxxotick.classhub.ui.common.noonOf
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// ---------------------------------------------------------------- Labels and colors

fun ScheduleKind.label(): String = when (this) {
    ScheduleKind.DEADLINE -> "Deliverable"
    ScheduleKind.QUIZ -> "Quiz"
    ScheduleKind.EXAM -> "Exam"
    ScheduleKind.RECITATION -> "Recitation"
    ScheduleKind.FCO -> "FCO"
}

private fun ScheduleKind.glyph(): String = when (this) {
    ScheduleKind.DEADLINE -> "D"
    ScheduleKind.QUIZ -> "Q"
    ScheduleKind.EXAM -> "EX"
    ScheduleKind.RECITATION -> "R"
    ScheduleKind.FCO -> "FCO"
}

private fun ScheduleKind.color(): Color = when (this) {
    ScheduleKind.DEADLINE -> Color(0xFF3730A3)
    ScheduleKind.QUIZ -> Color(0xFFB45309)
    ScheduleKind.EXAM -> Color(0xFFB91C1C)
    ScheduleKind.RECITATION -> Color(0xFF0F766E)
    ScheduleKind.FCO -> Color(0xFF7C3AED)
}

private val Green = Color(0xFF15803D)
private val Amber = Color(0xFFB45309)
private val Red = Color(0xFFB91C1C)
private val Grey = Color(0xFF6B768A)

/** Most dots shown under a day in the week strip; more items show a "+". */
private const val MAX_DOTS = 3

private fun statusColor(item: ScheduleItem, done: Boolean, now: Long): Color = when {
    ScheduleLogic.isCancelled(item) -> Grey
    done -> Green
    ScheduleView.isOverdue(item, now) -> Red
    else -> Amber
}

private fun longDay(day: LocalDate): String = day.format(DateTimeFormatter.ofPattern("EEE, MMM d", Locale.getDefault()))

private fun dayHeader(day: LocalDate, today: LocalDate): String = when (day) {
    today -> "Today"
    today.plusDays(1) -> "Tomorrow"
    today.minusDays(1) -> "Yesterday"
    else -> longDay(day)
}

@Composable
private fun KindBadge(kind: ScheduleKind) {
    Box(
        Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(kind.color().copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(kind.glyph(), color = kind.color(), fontWeight = FontWeight.Bold, fontSize = if (kind.glyph().length > 2) 11.sp else 14.sp)
    }
}

@Composable
private fun Tag(text: String, color: Color) {
    Text(
        text,
        color = color,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

/** A round tick the student taps to mark an item done for themselves. */
@Composable
private fun DoneCheck(done: Boolean, onToggle: () -> Unit) {
    Box(
        Modifier
            .size(30.dp)
            .clip(CircleShape)
            .then(if (done) Modifier.background(Green) else Modifier.border(2.dp, Grey.copy(alpha = 0.6f), CircleShape))
            .clickable(onClick = onToggle),
        contentAlignment = Alignment.Center,
    ) {
        if (done) Text("✓", color = Color.White, fontWeight = FontWeight.Bold)
    }
}

/**
 * One schedule line. Used on the Schedule tab and in "Coming up" on Home.
 * [onToggleDone] shows the tick circle; leave it null for a read-only row.
 */
@Composable
fun ScheduleRow(
    item: ScheduleItem,
    state: ClassUiState,
    now: Long,
    showDate: Boolean,
    onClick: (() -> Unit)? = null,
    onToggleDone: ((ScheduleItem, Boolean) -> Unit)? = null,
) {
    val done = item.id in state.myDone
    val cancelled = ScheduleLogic.isCancelled(item)
    val course = state.courses.firstOrNull { it.id == item.courseId }?.name
    val subtitle = listOfNotNull(
        course,
        item.kind.label(),
        if (showDate) longDay(ScheduleLogic.dateOf(item.dueMillis)) else null,
    ).joinToString("  ·  ")
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindBadge(item.kind)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                item.title,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textDecoration = if (cancelled) TextDecoration.LineThrough else null,
                color = if (cancelled || done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        Tag(ScheduleView.dueLabel(item, now, done = done), statusColor(item, done, now))
        if (onToggleDone != null && !cancelled) {
            Spacer(Modifier.width(10.dp))
            DoneCheck(done) { onToggleDone(item, !done) }
        }
    }
}

// ---------------------------------------------------------------- Schedule tab

@Composable
fun ScheduleTab(
    state: ClassUiState,
    progress: List<StudentProgress>,
    selectedEpochDay: Long?,
    onSelectDay: (Long?) -> Unit,
    onEdit: (String) -> Unit,
    onToggleDone: (ScheduleItem, Boolean) -> Unit,
    onSetCancelled: (ScheduleItem, Boolean) -> Unit,
) {
    val now = System.currentTimeMillis()
    val today = LocalDate.now()
    var anchorEpochDay by rememberSaveable { mutableStateOf(today.toEpochDay()) }
    var filterName by rememberSaveable { mutableStateOf(ScheduleFilter.UPCOMING.name) }
    var openedId by remember { mutableStateOf<String?>(null) }

    val filter = ScheduleFilter.valueOf(filterName)
    val week = ScheduleView.weekOf(LocalDate.ofEpochDay(anchorEpochDay))
    val kindsByDay = remember(state.schedule, state.myDone) { ScheduleView.openKindsByDay(state.schedule, doneIds = state.myDone) }
    val selectedDay = selectedEpochDay?.let { LocalDate.ofEpochDay(it) }
    val shown = if (selectedDay != null) ScheduleView.onDay(state.schedule, selectedDay)
    else ScheduleView.filter(state.schedule, filter, now, doneIds = state.myDone)
    val overdueCount = ScheduleView.filter(state.schedule, ScheduleFilter.OVERDUE, now, doneIds = state.myDone).size

    LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
        // Week strip
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { anchorEpochDay -= 7 }) { Text("‹") }
                Text(
                    "${week.first().format(DateTimeFormatter.ofPattern("MMM d", Locale.getDefault()))} – " +
                        week.last().format(DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())),
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f).clickable { anchorEpochDay = today.toEpochDay(); onSelectDay(null) },
                )
                TextButton(onClick = { anchorEpochDay += 7 }) { Text("›") }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                week.forEach { day ->
                    val selected = day == selectedDay
                    val isToday = day == today
                    val kinds = kindsByDay[day].orEmpty()
                    Column(
                        Modifier
                            .weight(1f)
                            .padding(horizontal = 2.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                            .clickable { onSelectDay(if (selected) null else day.toEpochDay()) }
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        val textColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                        Text(day.format(DateTimeFormatter.ofPattern("EEE", Locale.getDefault())), fontSize = 11.sp, color = textColor)
                        Text(
                            day.dayOfMonth.toString(),
                            fontWeight = if (isToday) FontWeight.ExtraBold else FontWeight.SemiBold,
                            color = if (selected) MaterialTheme.colorScheme.onPrimary else if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        )
                        // One dot per open item, colored like its type badge, most important first (up to three).
                        Row(
                            Modifier.padding(top = 3.dp).height(9.dp),
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            kinds.take(MAX_DOTS).forEach { kind ->
                                Box(
                                    Modifier
                                        .size(if (selected) 7.dp else 6.dp)
                                        .clip(CircleShape)
                                        .then(if (selected) Modifier.border(1.dp, MaterialTheme.colorScheme.onPrimary, CircleShape) else Modifier)
                                        .background(kind.color()),
                                )
                            }
                            if (kinds.size > MAX_DOTS) {
                                Text("+", fontSize = 9.sp, lineHeight = 9.sp, fontWeight = FontWeight.Bold, color = textColor)
                            }
                        }
                    }
                }
            }
        }

        // Filters, or the chosen day
        item {
            if (selectedDay != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Due ${longDay(selectedDay)}", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = { onSelectDay(null) }) { Text("Show all") }
                }
            } else {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(ScheduleFilter.entries.toList()) { f ->
                        FilterChip(
                            selected = f == filter,
                            onClick = { filterName = f.name },
                            label = { Text(if (f == ScheduleFilter.OVERDUE && overdueCount > 0) "${f.label} ($overdueCount)" else f.label) },
                        )
                    }
                }
            }
        }

        if (shown.isEmpty()) {
            item {
                Text(
                    when {
                        state.schedule.isEmpty() && state.can(Permission.SCHEDULE_MANAGE) -> "Nothing scheduled yet. Tap \"+ Add\" to add a deliverable, quiz or exam."
                        state.schedule.isEmpty() -> "Nothing scheduled yet. Officers who manage the schedule can add items here."
                        selectedDay != null -> "Nothing due on this day."
                        filter == ScheduleFilter.UPCOMING -> "You are all caught up."
                        else -> "Nothing here for this filter."
                    },
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                )
            }
        }

        if (selectedDay != null) {
            items(shown, key = { it.id }) {
                ScheduleRow(it, state, now, showDate = false, onClick = { openedId = it.id }, onToggleDone = onToggleDone)
            }
        } else {
            var lastHeader = ""
            shown.forEach { item ->
                val header = dayHeader(ScheduleLogic.dateOf(item.dueMillis), today)
                if (header != lastHeader) {
                    lastHeader = header
                    item(key = "h:$header:${item.id}") {
                        Text(
                            header.uppercase(),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 2.dp),
                        )
                    }
                }
                item(key = item.id) {
                    ScheduleRow(item, state, now, showDate = false, onClick = { openedId = item.id }, onToggleDone = onToggleDone)
                }
            }
        }
    }

    // Show the live copy so a change is reflected while the dialog is open.
    val opened = openedId?.let { id -> state.schedule.firstOrNull { it.id == id } }
    if (opened != null) {
        ScheduleDetailsDialog(
            item = opened,
            state = state,
            progress = progress,
            now = now,
            onDismiss = { openedId = null },
            onEdit = { openedId = null; onEdit(opened.id) },
            onToggleDone = { done -> onToggleDone(opened, done) },
            onSetCancelled = { cancelled -> openedId = null; onSetCancelled(opened, cancelled) },
        )
    }
}

@Composable
private fun ScheduleDetailsDialog(
    item: ScheduleItem,
    state: ClassUiState,
    progress: List<StudentProgress>,
    now: Long,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onToggleDone: (Boolean) -> Unit,
    onSetCancelled: (Boolean) -> Unit,
) {
    val canManage = state.can(Permission.SCHEDULE_MANAGE)
    val done = item.id in state.myDone
    val cancelled = ScheduleLogic.isCancelled(item)
    val course = state.courses.firstOrNull { it.id == item.courseId }?.name
    var showWho by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(item.title) },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    KindBadge(item.kind)
                    Spacer(Modifier.width(10.dp))
                    Tag(ScheduleView.dueLabel(item, now, done = done), statusColor(item, done, now))
                }
                DetailLine("Type", item.kind.label())
                DetailLine("Course", course ?: "Whole class")
                DetailLine("Due", ScheduleLogic.dateOf(item.dueMillis).format(DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.getDefault())))
                if (item.note.isNotBlank()) DetailLine("Note", item.note)

                if (cancelled) {
                    Text("This was cancelled for the whole class.", color = Grey, fontWeight = FontWeight.SemiBold)
                } else {
                    Spacer(Modifier.height(4.dp))
                    if (done) {
                        OutlinedButton(onClick = { onToggleDone(false) }, modifier = Modifier.fillMaxWidth()) { Text("Mark as not done") }
                    } else {
                        Button(onClick = { onToggleDone(true) }, modifier = Modifier.fillMaxWidth()) { Text("Mark as done") }
                    }
                    Text(
                        "Only you can see and change your own mark.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (canManage) {
                    HorizontalDivider(Modifier.padding(vertical = 6.dp))
                    Text("FOR OFFICERS", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (!cancelled) {
                        val summary = ScheduleView.completion(item.id, state.members, progress)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Marked done by ${summary.done.size} of ${summary.total}", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            TextButton(onClick = { showWho = !showWho }) { Text(if (showWho) "Hide" else "See who") }
                        }
                        if (showWho) {
                            if (summary.done.isNotEmpty()) {
                                Text("Done", color = Green, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                                summary.done.forEach { Text("• ${it.name}", style = MaterialTheme.typography.bodySmall) }
                            }
                            if (summary.notDone.isNotEmpty()) {
                                Text("Not yet", color = Amber, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                                summary.notDone.forEach { Text("• ${it.name}", style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                    OutlinedButton(onClick = { onSetCancelled(!cancelled) }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (cancelled) "Restore for the class" else "Cancel for the whole class")
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        dismissButton = { if (canManage) TextButton(onClick = onEdit) { Text("Edit") } },
    )
}

@Composable
private fun DetailLine(label: String, value: String) {
    Row {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(76.dp))
        Text(value, fontWeight = FontWeight.SemiBold)
    }
}

// ---------------------------------------------------------------- Add / edit form

/** [itemId] is null when adding a new item. */
@Composable
fun ScheduleFormScreen(
    state: ClassUiState,
    itemId: String?,
    defaultDay: LocalDate?,
    busy: Boolean,
    notice: String?,
    onSave: (ScheduleItem) -> Unit,
    onDelete: (ScheduleItem) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    val existing = itemId?.let { id -> state.schedule.firstOrNull { it.id == id } }
    ManageScaffold(if (existing == null) "Add to schedule" else "Edit schedule item", state, notice, onClearNotice, onBack) { padding ->
        when {
            !state.can(Permission.SCHEDULE_MANAGE) -> {
                Text("Your role does not allow you to manage the schedule.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(32.dp))
                return@ManageScaffold
            }
            itemId != null && existing == null -> {
                Text("This item was deleted.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(32.dp))
                return@ManageScaffold
            }
        }
        var kindName by rememberSaveable(existing?.id) { mutableStateOf(existing?.kind?.name ?: ScheduleKind.DEADLINE.name) }
        var title by rememberSaveable(existing?.id) { mutableStateOf(existing?.title.orEmpty()) }
        var courseId by rememberSaveable(existing?.id) { mutableStateOf(existing?.courseId.orEmpty()) }
        var dueMillis by rememberSaveable(existing?.id) { mutableStateOf(existing?.dueMillis ?: noonOf(defaultDay ?: LocalDate.now())) }
        var cancelled by rememberSaveable(existing?.id) { mutableStateOf(existing?.let { ScheduleLogic.isCancelled(it) } ?: false) }
        var note by rememberSaveable(existing?.id) { mutableStateOf(existing?.note.orEmpty()) }
        var pickingCourse by remember { mutableStateOf(false) }
        var confirmDelete by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        val courseName = state.courses.firstOrNull { it.id == courseId }?.name ?: "Whole class (no course)"

        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Everyone in the class sees this. Each student marks it done for themselves.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text("Type", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ScheduleKind.entries.toList()) { kind ->
                    FilterChip(selected = kind.name == kindName, onClick = { kindName = kind.name }, label = { Text(kind.label()) })
                }
            }
            OutlinedTextField(
                value = title,
                onValueChange = { title = it.take(ScheduleForms.MAX_TITLE); error = null },
                label = { Text("Title") },
                placeholder = { Text("e.g. Midterm Exam, Assignment #3") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            PickerField(label = "Course", value = courseName, onClick = { pickingCourse = true })
            DateField(dueMillis, label = "Due date", dayOnly = true) { dueMillis = it }
            if (existing != null) {
                Text("For the whole class", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !cancelled, onClick = { cancelled = false }, label = { Text("Active") })
                    FilterChip(selected = cancelled, onClick = { cancelled = true }, label = { Text("Cancelled") })
                }
            }
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(160) },
                label = { Text("Note (optional)") },
                placeholder = { Text("e.g. Covers Units 1 to 3, bring a calculator") },
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    error = ScheduleForms.check(title)
                    if (error == null) {
                        onSave(
                            ScheduleItem(
                                id = existing?.id.orEmpty(),
                                courseId = courseId,
                                title = title,
                                kind = ScheduleKind.valueOf(kindName),
                                dueMillis = dueMillis,
                                status = if (cancelled) ScheduleStatus.CANCELLED else ScheduleStatus.PENDING,
                                note = note,
                                createdByUid = existing?.createdByUid.orEmpty(),
                            ),
                        )
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (existing == null) "Add to schedule" else "Save changes") }
            if (existing != null) {
                OutlinedButton(
                    onClick = { confirmDelete = true },
                    enabled = !busy,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Delete") }
            }
        }

        if (pickingCourse) {
            AlertDialog(
                onDismissRequest = { pickingCourse = false },
                title = { Text("Course") },
                text = {
                    LazyColumn(Modifier.heightIn(max = 360.dp)) {
                        item {
                            Text("Whole class (no course)", modifier = Modifier.fillMaxWidth().clickable { courseId = ""; pickingCourse = false }.padding(vertical = 12.dp))
                        }
                        items(state.courses, key = { it.id }) { course ->
                            Text(course.name, modifier = Modifier.fillMaxWidth().clickable { courseId = course.id; pickingCourse = false }.padding(vertical = 12.dp))
                        }
                    }
                },
                confirmButton = {},
                dismissButton = { TextButton(onClick = { pickingCourse = false }) { Text("Cancel") } },
            )
        }

        if (confirmDelete && existing != null) {
            AlertDialog(
                onDismissRequest = { confirmDelete = false },
                title = { Text("Delete \"${existing.title}\"?") },
                text = { Text("It will be removed from the schedule for everyone in the class.") },
                confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete(existing) }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
                dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
            )
        }
    }
}

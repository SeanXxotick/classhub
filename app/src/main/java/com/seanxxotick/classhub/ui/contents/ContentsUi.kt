package com.seanxxotick.classhub.ui.contents

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.ContentKind
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.domain.ContentRules
import com.seanxxotick.classhub.ui.classroom.ClassUiState
import com.seanxxotick.classhub.ui.classroom.ManageScaffold
import java.net.URI

// ---------------------------------------------------------------- Shared bits

private fun ContentKind.label(): String = when (this) {
    ContentKind.FILE -> "File"
    ContentKind.VIDEO -> "Video"
    ContentKind.WEBSITE -> "Website"
}

private fun ContentKind.glyph(): String = when (this) {
    ContentKind.FILE -> "F"
    ContentKind.VIDEO -> "▶"
    ContentKind.WEBSITE -> "W"
}

private fun ContentKind.color(): Color = when (this) {
    ContentKind.FILE -> Color(0xFF2563EB)
    ContentKind.VIDEO -> Color(0xFFDC2626)
    ContentKind.WEBSITE -> Color(0xFF0F766E)
}

/** "drive.google.com" from a full link, for the subtitle. */
private fun hostOf(url: String): String = runCatching { URI(url).host }.getOrNull()?.removePrefix("www.").orEmpty()

@Composable
private fun KindBadge(kind: ContentKind) {
    Box(
        Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(kind.color().copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(kind.glyph(), color = kind.color(), fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

/** Opens a link in Google Drive, YouTube or the browser. Calls [onError] if the phone has nothing that can open it. */
fun openLink(context: android.content.Context, url: String, onError: (String) -> Unit) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        onError("No app on this phone can open that link.")
    }
}

// ---------------------------------------------------------------- Contents tab

private const val ALL = "*all*"
private const val GENERAL = ""

@Composable
fun ContentsTab(state: ClassUiState, onEdit: (String) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    var query by rememberSaveable { mutableStateOf("") }
    var courseFilter by rememberSaveable { mutableStateOf(ALL) }
    val canManage = state.can(Permission.CONTENTS_MANAGE)

    val knownCourses = state.courses.map { it.id }.toSet()
    val shown = state.contents.filter { item ->
        ContentRules.matches(item, query) && when (courseFilter) {
            ALL -> true
            GENERAL -> item.courseId.isEmpty() || item.courseId !in knownCourses
            else -> item.courseId == courseFilter
        }
    }
    val groups = ContentRules.grouped(shown, state.courses)

    LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search contents") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selected = courseFilter == ALL, onClick = { courseFilter = ALL }, label = { Text("All") }) }
                item { FilterChip(selected = courseFilter == GENERAL, onClick = { courseFilter = GENERAL }, label = { Text("General") }) }
                items(state.courses, key = { it.id }) { course ->
                    FilterChip(selected = courseFilter == course.id, onClick = { courseFilter = course.id }, label = { Text(course.name) })
                }
            }
        }
        if (groups.isEmpty()) {
            item {
                Text(
                    when {
                        state.contents.isEmpty() && canManage -> "No class contents yet. Tap \"+ Add content\" to share a Google Drive file, a recorded discussion or a website."
                        state.contents.isEmpty() -> "No class contents yet. Officers who manage class contents can add links here."
                        else -> "Nothing matches your search."
                    },
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                )
            }
        }
        groups.forEach { (course, items) ->
            item(key = "h:" + (course?.id ?: "general")) {
                Text(
                    "${(course?.name ?: "General").uppercase()}  ·  ${items.size}",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
                )
            }
            items(items, key = { it.id }) { item ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { openLink(context, item.url, onError) }
                        .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    KindBadge(item.kind)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOf(item.kind.label(), hostOf(item.url), item.note).filter { it.isNotBlank() }.joinToString("  ·  "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (canManage) TextButton(onClick = { onEdit(item.id) }) { Text("Edit") }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Add / edit form

/** [contentId] is null when adding a new item. */
@Composable
fun ContentFormScreen(
    state: ClassUiState,
    contentId: String?,
    busy: Boolean,
    notice: String?,
    onSave: (ContentItem) -> Unit,
    onDelete: (ContentItem) -> Unit,
    onError: (String) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    val existing = contentId?.let { id -> state.contents.firstOrNull { it.id == id } }
    ManageScaffold(if (existing == null) "Add content" else "Edit content", state, notice, onClearNotice, onBack) { padding ->
        when {
            !state.can(Permission.CONTENTS_MANAGE) -> {
                Text(
                    "Your role does not allow you to manage class contents.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(padding).padding(32.dp),
                )
                return@ManageScaffold
            }
            contentId != null && existing == null -> {
                Text(
                    "This item was deleted.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(padding).padding(32.dp),
                )
                return@ManageScaffold
            }
        }
        val context = LocalContext.current
        var title by rememberSaveable(existing?.id) { mutableStateOf(existing?.title.orEmpty()) }
        var url by rememberSaveable(existing?.id) { mutableStateOf(existing?.url.orEmpty()) }
        var note by rememberSaveable(existing?.id) { mutableStateOf(existing?.note.orEmpty()) }
        var courseId by rememberSaveable(existing?.id) { mutableStateOf(existing?.courseId.orEmpty()) }
        var kindName by rememberSaveable(existing?.id) { mutableStateOf(existing?.kind?.name ?: ContentKind.WEBSITE.name) }
        // Until the user picks a kind themselves, it follows the link.
        var kindChosen by rememberSaveable(existing?.id) { mutableStateOf(existing != null) }
        var pickingCourse by remember { mutableStateOf(false) }
        var confirmDelete by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        val courseName = state.courses.firstOrNull { it.id == courseId }?.name ?: "General (no course)"

        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Share a link to class material. Files stay in Google Drive (or wherever they are); make sure the link's sharing allows your classmates to open it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = title,
                onValueChange = { title = it.take(ContentRules.MAX_TITLE); error = null },
                label = { Text("Title") },
                placeholder = { Text("e.g. Unit 1 Module 3 - AdCal") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = url,
                onValueChange = { input ->
                    url = input.trim()
                    error = null
                    if (!kindChosen) kindName = ContentRules.guessKind(ContentRules.normalizeUrl(url)).name
                },
                label = { Text("Link") },
                placeholder = { Text("Paste a Google Drive or website link") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Type", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ContentKind.entries.forEach { kind ->
                    FilterChip(
                        selected = kind.name == kindName,
                        onClick = { kindName = kind.name; kindChosen = true },
                        label = { Text(kind.label()) },
                    )
                }
            }
            Box {
                OutlinedTextField(
                    value = courseName,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Course") },
                    trailingIcon = { Text("▾") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Box(Modifier.matchParentSize().clickable { pickingCourse = true })
            }
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(120) },
                label = { Text("Note (optional)") },
                placeholder = { Text("e.g. Covers Theorems 4 and 5") },
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    error = ContentRules.check(title, url)
                    if (error == null) {
                        onSave(
                            ContentItem(
                                id = existing?.id.orEmpty(),
                                courseId = courseId,
                                title = title,
                                url = url,
                                kind = ContentKind.valueOf(kindName),
                                note = note,
                                createdByUid = existing?.createdByUid.orEmpty(),
                                createdAtMillis = existing?.createdAtMillis ?: 0L,
                            ),
                        )
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (existing == null) "Add content" else "Save changes") }
            OutlinedButton(
                onClick = {
                    val normalized = ContentRules.normalizeUrl(url)
                    if (ContentRules.isValidUrl(normalized)) openLink(context, normalized, onError)
                    else error = "That does not look like a web link yet."
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Test the link") }
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
                            Text("General (no course)", modifier = Modifier.fillMaxWidth().clickable { courseId = GENERAL; pickingCourse = false }.padding(vertical = 12.dp))
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
                text = { Text("Only the link is removed from ClassHub. The file itself stays in Google Drive.") },
                confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete(existing) }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
                dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
            )
        }
    }
}

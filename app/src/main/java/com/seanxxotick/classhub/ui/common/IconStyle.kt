package com.seanxxotick.classhub.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.R
import com.seanxxotick.classhub.domain.IconLibrary
import com.seanxxotick.classhub.ui.theme.hexToColor

/** The drawing for each icon key in [IconLibrary.ICONS]. */
fun iconRes(key: String): Int = when (key) {
    "pencil" -> R.drawable.ic_kind_quiz
    "clipboard" -> R.drawable.ic_kind_exam
    "mic" -> R.drawable.ic_kind_recitation
    "flag" -> R.drawable.ic_kind_fco
    "play" -> R.drawable.ic_sched_play
    "file" -> R.drawable.ic_sched_file
    "globe" -> R.drawable.ic_sched_globe
    "link" -> R.drawable.ic_sched_link
    "folder" -> R.drawable.ic_sched_folder
    "image" -> R.drawable.ic_sched_image
    "book" -> R.drawable.ic_sched_book
    "calculator" -> R.drawable.ic_sched_calculator
    "laptop" -> R.drawable.ic_sched_laptop
    "presentation" -> R.drawable.ic_sched_presentation
    "flask" -> R.drawable.ic_sched_flask
    "lightbulb" -> R.drawable.ic_sched_lightbulb
    "group" -> R.drawable.ic_sched_group
    "star" -> R.drawable.ic_sched_star
    "calendar" -> R.drawable.ic_sched_calendar
    "clock" -> R.drawable.ic_sched_clock
    "trophy" -> R.drawable.ic_sched_trophy
    "chat" -> R.drawable.ic_sched_chat
    "cap" -> R.drawable.ic_sched_cap
    "ruler" -> R.drawable.ic_sched_ruler
    "code" -> R.drawable.ic_sched_code
    "video" -> R.drawable.ic_sched_video
    else -> R.drawable.ic_kind_deliverable
}

/** A plain line icon in its color, with no background so it stays minimal. */
@Composable
fun StyledIcon(icon: String, colorHex: String, description: String?, iconSize: Dp = 26.dp, boxSize: Dp = 38.dp) {
    Box(Modifier.size(boxSize), contentAlignment = Alignment.Center) {
        Icon(painterResource(iconRes(icon)), contentDescription = description, tint = hexToColor(colorHex), modifier = Modifier.size(iconSize))
    }
}

/** A settings row: the type's current icon and color, its name, and a Change button. */
@Composable
fun IconStyleRow(label: String, icon: String, colorHex: String, isDefault: Boolean, onChange: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onChange).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StyledIcon(icon, colorHex, description = null)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontWeight = FontWeight.SemiBold)
            if (isDefault) Text("Default", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = onChange) { Text("Change") }
    }
}

/**
 * Picks an icon and a color for one type, with a live preview. Nothing is saved until
 * the officer taps Done here and then Save settings.
 */
@Composable
fun IconStylePicker(
    title: String,
    icon: String,
    colorHex: String,
    defaultIcon: String,
    defaultColor: String,
    onDone: (icon: String, colorHex: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var pickedIcon by remember { mutableStateOf(icon) }
    var pickedColor by remember { mutableStateOf(colorHex) }
    val color = hexToColor(pickedColor)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StyledIcon(pickedIcon, pickedColor, description = null, iconSize = 30.dp, boxSize = 40.dp)
                Spacer(Modifier.width(8.dp))
                Text(title)
            }
        },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Icon", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                IconLibrary.ICONS.chunked(5).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { key ->
                            Box(
                                Modifier
                                    .size(44.dp)
                                    .clip(CircleShape)
                                    .then(if (key == pickedIcon) Modifier.border(2.dp, color, CircleShape) else Modifier)
                                    .clickable { pickedIcon = key },
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(painterResource(iconRes(key)), contentDescription = key, tint = color, modifier = Modifier.size(26.dp))
                            }
                        }
                    }
                }
                Spacer(Modifier.size(4.dp))
                Text("Color", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                IconLibrary.COLORS.chunked(5).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { hex ->
                            val selected = hex.equals(pickedColor, ignoreCase = true)
                            Box(
                                Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .then(if (selected) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                                    .padding(if (selected) 4.dp else 0.dp)
                                    .clip(CircleShape)
                                    .background(hexToColor(hex))
                                    .clickable { pickedColor = hex },
                            )
                        }
                    }
                }
                TextButton(onClick = { pickedIcon = defaultIcon; pickedColor = defaultColor }) { Text("Use default") }
            }
        },
        confirmButton = { TextButton(onClick = { onDone(pickedIcon, pickedColor) }) { Text("Done") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

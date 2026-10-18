package com.seanxxotick.classhub.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.seanxxotick.classhub.ui.theme.hexToColor

/** Rounded letter badge used for classes and members, e.g. "3A" or "MS". */
@Composable
fun Initials(text: String, color: Color, modifier: Modifier = Modifier, circle: Boolean = false) {
    Box(
        modifier = modifier
            .size(42.dp)
            .clip(if (circle) CircleShape else RoundedCornerShape(14.dp))
            .background(color),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

/** Small colored pill showing a role name. */
@Composable
fun RoleChip(name: String, colorHex: String) {
    val color = hexToColor(colorHex)
    Text(
        text = name,
        color = color,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** A row of round color swatches; the selected one gets a ring. */
@Composable
fun AccentPicker(choices: List<String>, selected: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        choices.forEach { hex ->
            val isSelected = hex.equals(selected, ignoreCase = true)
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .border(
                        width = if (isSelected) 3.dp else 0.dp,
                        color = if (isSelected) MaterialTheme.colorScheme.onSurface else Color.Transparent,
                        shape = CircleShape,
                    )
                    .padding(if (isSelected) 4.dp else 0.dp)
                    .clip(CircleShape)
                    .background(hexToColor(hex))
                    .clickable { onSelect(hex) },
            )
        }
    }
}

/** "BSM CS 3A" -> "3A", "Juan Dela Cruz" -> "JD". */
fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        words.last().length <= 3 -> words.last().uppercase()
        else -> (words.first().take(1) + words.last().take(1)).uppercase()
    }
}

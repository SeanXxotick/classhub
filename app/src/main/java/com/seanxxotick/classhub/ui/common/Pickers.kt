package com.seanxxotick.classhub.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The date picker works in UTC midnights; the app stores a local time on the chosen day.
 * Today keeps the current time (so same-day records stay in order); other days, and every
 * [dayOnly] date such as a deadline, are stored at local noon.
 */
private fun pickerToLocalMillis(utcMidnight: Long, dayOnly: Boolean): Long {
    val day = Instant.ofEpochMilli(utcMidnight).atZone(ZoneOffset.UTC).toLocalDate()
    val zone = ZoneId.systemDefault()
    return if (!dayOnly && day == LocalDate.now(zone)) System.currentTimeMillis()
    else day.atTime(LocalTime.NOON).atZone(zone).toInstant().toEpochMilli()
}

private fun localToPickerMillis(millis: Long): Long =
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

/** Local noon on [day], the way day-only dates are stored. */
fun noonOf(day: LocalDate): Long = day.atTime(LocalTime.NOON).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

/** "Mon, Oct 19, 2026" */
private fun longDate(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate()
        .format(DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", Locale.getDefault()))

/** A read-only field that opens a picker when tapped. */
@Composable
fun PickerField(label: String, value: String, onClick: () -> Unit, supporting: String? = null) {
    Box {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { Text("▾") },
            supportingText = supporting?.let { { Text(it) } },
            modifier = Modifier.fillMaxWidth(),
        )
        // Cover the field so a tap anywhere opens the picker.
        Box(Modifier.matchParentSize().clickable(onClick = onClick))
    }
}

/** A date field that opens the calendar picker. Set [dayOnly] for dates without a meaningful time, like deadlines. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(millis: Long, label: String = "Date", dayOnly: Boolean = false, onChange: (Long) -> Unit) {
    var open by remember { mutableStateOf(false) }
    PickerField(label = label, value = longDate(millis), onClick = { open = true })
    if (open) {
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = localToPickerMillis(millis))
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { onChange(pickerToLocalMillis(it, dayOnly)) }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(state = pickerState) }
    }
}

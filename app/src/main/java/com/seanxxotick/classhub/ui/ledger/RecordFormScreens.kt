package com.seanxxotick.classhub.ui.ledger

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.RecordType
import com.seanxxotick.classhub.domain.ChargePlanner
import com.seanxxotick.classhub.domain.ChargePreview
import com.seanxxotick.classhub.domain.LedgerEntry
import com.seanxxotick.classhub.domain.LedgerForms
import com.seanxxotick.classhub.domain.LedgerView
import com.seanxxotick.classhub.domain.Money
import com.seanxxotick.classhub.ui.classroom.ClassUiState
import com.seanxxotick.classhub.ui.classroom.ManageScaffold
import com.seanxxotick.classhub.ui.common.DateField
import com.seanxxotick.classhub.ui.common.PickerField
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

@Composable
private fun AmountField(text: String, onChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = text,
        onValueChange = { input -> onChange(input.filter { it.isDigit() || it == '.' || it == ',' }.take(14)) },
        label = { Text(label) },
        prefix = { Text("₱") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Searchable list of members, showing each one's balance. */
@Composable
private fun MemberPickerDialog(state: ClassUiState, onPick: (Member) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val shown = state.members.filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a member") },
        text = {
            Column {
                OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text("Search") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(shown, key = { it.id }) { member ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onPick(member) }.padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(member.name, modifier = Modifier.weight(1f))
                            Text(balanceText(state.balanceOf(member.id)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- Payment, Withdrawal, Pay out from fund

@Composable
fun RecordFormScreen(
    state: ClassUiState,
    type: RecordType,
    busy: Boolean,
    notice: String?,
    onSave: (LedgerRecord) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    ManageScaffold(type.label(), state, notice, onClearNotice, onBack) { padding ->
        if (!state.can(Permission.RECORDS_MANAGE)) {
            Text(
                "Your role does not allow you to add ledger records.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(padding).padding(32.dp),
            )
            return@ManageScaffold
        }
        var amountText by rememberSaveable { mutableStateOf("") }
        var memberId by rememberSaveable { mutableStateOf("") }
        var note by rememberSaveable { mutableStateOf("") }
        var dateMillis by rememberSaveable { mutableStateOf(System.currentTimeMillis()) }
        var picking by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }

        val member = state.members.firstOrNull { it.id == memberId }
        val amount = Money.parsePesos(amountText)

        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (type == RecordType.WITHDRAWAL) "A student takes part of their balance out, like a savings account. It cannot be more than their balance."
                else "Money a student pays into the class fund. Adds to their balance.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AmountField(amountText, { amountText = it; error = null }, "Amount")
            PickerField(
                label = if (type == RecordType.PAYMENT) "Who paid" else "Who is withdrawing",
                value = member?.name ?: "Tap to choose",
                onClick = { picking = true },
                supporting = member?.let { "Current ${balanceText(state.balanceOf(it.id)).lowercase()}" },
            )
            DateField(dateMillis) { dateMillis = it }
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(80); error = null },
                label = { Text("Note (optional)") },
                placeholder = { Text(if (type == RecordType.WITHDRAWAL) "e.g. Asked for cash back" else "e.g. October dues") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    error = LedgerForms.checkRecord(type, amount, memberId, member?.let { state.balanceOf(it.id) })
                    if (error == null && amount != null) {
                        onSave(
                            LedgerRecord(
                                type = type,
                                amountCentavos = amount,
                                memberId = memberId,
                                memberName = member?.name.orEmpty(),
                                note = note.trim(),
                                dateMillis = dateMillis,
                            ),
                        )
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Save " + type.label().lowercase()) }
        }

        if (picking) {
            MemberPickerDialog(state, onPick = { memberId = it.id; picking = false; error = null }, onDismiss = { picking = false })
        }
    }
}

// ---------------------------------------------------------------- Pay out from fund

/** Pays out one charge in full. [preselectedBatchId] comes from the charge's "Record pay-out" button. */
@Composable
fun PayoutFormScreen(
    state: ClassUiState,
    preselectedBatchId: String,
    busy: Boolean,
    notice: String?,
    onSave: (charge: LedgerEntry.ChargeBatch?, paidTo: String, dateMillis: Long) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    ManageScaffold(RecordType.EXPENSE.label(), state, notice, onClearNotice, onBack) { padding ->
        if (!state.can(Permission.RECORDS_MANAGE)) {
            Text(
                "Your role does not allow you to record pay-outs.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(padding).padding(32.dp),
            )
            return@ManageScaffold
        }
        val unpaid = LedgerView.unpaidCharges(state.records)
        var batchId by rememberSaveable { mutableStateOf(preselectedBatchId) }
        var paidTo by rememberSaveable { mutableStateOf("") }
        var dateMillis by rememberSaveable { mutableStateOf(System.currentTimeMillis()) }
        var picking by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        val charge = unpaid.firstOrNull { it.batchId == batchId }

        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Every pay-out settles one charge, for exactly what was charged. To spend money on something new, charge the students first.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (unpaid.isEmpty()) {
                Text(
                    "There are no charges waiting to be paid out.",
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
                return@Column
            }
            PickerField(
                label = "Charge being paid out",
                value = charge?.note ?: "Tap to choose",
                onClick = { picking = true },
                supporting = charge?.let { "${it.count} student${if (it.count == 1) "" else "s"} · charged ${fullDate(it.dateMillis)}" },
            )
            OutlinedTextField(
                value = charge?.let { Money.format(it.totalCentavos) } ?: "",
                onValueChange = {},
                readOnly = true,
                label = { Text("Amount (the charge's total)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = paidTo,
                onValueChange = { paidTo = it.take(60) },
                label = { Text("Paid to (optional)") },
                placeholder = { Text("e.g. Prof. Santos") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            DateField(dateMillis) { dateMillis = it }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    error = LedgerForms.checkPayout(charge, alreadyPaidOut = false)
                    if (error == null) onSave(charge, paidTo, dateMillis)
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(charge?.let { "Pay out " + Money.format(it.totalCentavos) } ?: "Pay out") }
        }

        if (picking) {
            AlertDialog(
                onDismissRequest = { picking = false },
                title = { Text("Waiting to be paid out") },
                text = {
                    LazyColumn(Modifier.heightIn(max = 380.dp)) {
                        items(unpaid, key = { it.batchId }) { c ->
                            Row(
                                Modifier.fillMaxWidth().clickable { batchId = c.batchId; picking = false; error = null }.padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(c.note, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        "${c.count} student${if (c.count == 1) "" else "s"} · ${fullDate(c.dateMillis)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(Money.format(c.totalCentavos), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                },
                confirmButton = {},
                dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
            )
        }
    }
}

// ---------------------------------------------------------------- Charge students

private const val WHOLE_CLASS = ""

@Composable
fun ChargeStudentsScreen(
    state: ClassUiState,
    busy: Boolean,
    notice: String?,
    onCharge: (preview: ChargePreview, note: String, courseId: String, dateMillis: Long, payNow: Boolean, paidTo: String) -> Unit,
    onClearNotice: () -> Unit,
    onBack: () -> Unit,
) {
    ManageScaffold(RecordType.CHARGE.label(), state, notice, onClearNotice, onBack) { padding ->
        if (!state.can(Permission.RECORDS_MANAGE)) {
            Text(
                "Your role does not allow you to charge students.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(padding).padding(32.dp),
            )
            return@ManageScaffold
        }
        var amountText by rememberSaveable { mutableStateOf("") }
        var note by rememberSaveable { mutableStateOf("") }
        var courseId by rememberSaveable { mutableStateOf(WHOLE_CLASS) }
        var payNow by rememberSaveable { mutableStateOf(false) }
        var paidTo by rememberSaveable { mutableStateOf("") }
        var dateMillis by rememberSaveable { mutableStateOf(System.currentTimeMillis()) }
        var pickingCourse by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }

        val eligibleIds = remember(state.members, courseId) { ChargePlanner.eligible(state.members, courseId).map { it.id }.toSet() }
        // The checklist starts from who takes the course and resets when the course changes.
        var selected by remember(courseId, state.members.size) { mutableStateOf(eligibleIds) }

        val perMember = Money.parsePesos(amountText)
        val preview = ChargePlanner.preview(
            members = state.members,
            courseId = courseId,
            perMemberCentavos = perMember ?: 0L,
            forceInclude = selected - eligibleIds,
            forceExclude = eligibleIds - selected,
        )
        val courseName = state.courses.firstOrNull { it.id == courseId }?.name

        LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "Deducts the same amount from each chosen student's balance, like a quiz fee. Cash on hand does not change.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    AmountField(amountText, { amountText = it; error = null }, "Amount per student")
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it.take(80); error = null },
                        label = { Text("Description") },
                        placeholder = { Text("e.g. Quiz - Operations Research") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    PickerField(
                        label = "Course",
                        value = courseName ?: "Whole class",
                        onClick = { pickingCourse = true },
                        supporting = if (courseName != null) "Students who do not take $courseName are unticked." else null,
                    )
                    DateField(dateMillis) { dateMillis = it }
                    Row(
                        Modifier.fillMaxWidth().clickable { payNow = !payNow },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Also record the pay-out now", fontWeight = FontWeight.SemiBold)
                            Text(
                                "Turn on if the money is being paid out today, for example handed to the professor.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(checked = payNow, onCheckedChange = { payNow = it })
                    }
                    if (payNow) {
                        OutlinedTextField(
                            value = paidTo,
                            onValueChange = { paidTo = it.take(60) },
                            label = { Text("Paid to (optional)") },
                            placeholder = { Text("e.g. Prof. Santos") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(
                                "${Money.format(perMember ?: 0L)} × ${preview.charged.size} student${if (preview.charged.size == 1) "" else "s"} = ${Money.format(preview.totalCentavos)}",
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.titleMedium,
                            )
                            if (preview.skipped.isNotEmpty()) {
                                Text(
                                    "${preview.skipped.size} student${if (preview.skipped.size == 1) "" else "s"} not charged",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Button(
                        onClick = {
                            error = LedgerForms.checkCharge(perMember, note, preview.charged.size)
                            if (error == null) onCharge(preview, note, courseId, dateMillis, payNow, paidTo)
                        },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) {
                        Text(
                            "Charge ${preview.charged.size} student${if (preview.charged.size == 1) "" else "s"}" +
                                if (payNow) " and pay out" else "",
                        )
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("WHO IS CHARGED", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    TextButton(onClick = { selected = state.members.map { it.id }.toSet() }) { Text("All") }
                    TextButton(onClick = { selected = emptySet() }) { Text("None") }
                }
            }
            items(state.members, key = { it.id }) { member ->
                val checked = member.id in selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { selected = if (checked) selected - member.id else selected + member.id }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = checked, onCheckedChange = { on -> selected = if (on) selected + member.id else selected - member.id })
                    Spacer(Modifier.width(4.dp))
                    Column(Modifier.weight(1f)) {
                        Text(member.name)
                        if (member.id !in eligibleIds && courseName != null) {
                            Text("Does not take $courseName", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text(balanceText(state.balanceOf(member.id)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        if (pickingCourse) {
            AlertDialog(
                onDismissRequest = { pickingCourse = false },
                title = { Text("Charge by course") },
                text = {
                    LazyColumn(Modifier.heightIn(max = 360.dp)) {
                        item {
                            Text("Whole class", modifier = Modifier.fillMaxWidth().clickable { courseId = WHOLE_CLASS; pickingCourse = false }.padding(vertical = 12.dp))
                        }
                        items(state.courses, key = { it.id }) { course ->
                            Text(course.name, modifier = Modifier.fillMaxWidth().clickable { courseId = course.id; pickingCourse = false }.padding(vertical = 12.dp))
                        }
                        if (state.courses.isEmpty()) {
                            item {
                                Text("No courses yet. Add them under Home → Courses.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                },
                confirmButton = {},
                dismissButton = { TextButton(onClick = { pickingCourse = false }) { Text("Cancel") } },
            )
        }
    }
}

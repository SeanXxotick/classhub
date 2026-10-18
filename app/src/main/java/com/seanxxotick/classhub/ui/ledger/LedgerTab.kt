package com.seanxxotick.classhub.ui.ledger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.Permission
import com.seanxxotick.classhub.data.model.RecordType
import com.seanxxotick.classhub.domain.Ledger
import com.seanxxotick.classhub.domain.LedgerEntry
import com.seanxxotick.classhub.domain.LedgerFilter
import com.seanxxotick.classhub.domain.LedgerView
import com.seanxxotick.classhub.domain.Money
import com.seanxxotick.classhub.ui.classroom.ClassUiState
import com.seanxxotick.classhub.ui.common.Avatar
import androidx.compose.foundation.shape.CircleShape
import com.seanxxotick.classhub.ui.theme.Expense
import com.seanxxotick.classhub.ui.theme.Income
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// ---------------------------------------------------------------- Labels, colors and dates

val ChargeColor = Color(0xFFA21CAF)
private val WithdrawColor = Color(0xFF0369A1)

/** What the user sees for each record type. */
fun RecordType.label(): String = when (this) {
    RecordType.PAYMENT -> "Payment"
    RecordType.CHARGE -> "Charge students"
    RecordType.WITHDRAWAL -> "Withdrawal"
    RecordType.EXPENSE -> "Pay out from fund"
}

private fun RecordType.glyph(): String = when (this) {
    RecordType.PAYMENT -> "+"
    RecordType.CHARGE -> "C"
    RecordType.WITHDRAWAL -> "W"
    RecordType.EXPENSE -> "−"
}

private fun RecordType.color(): Color = when (this) {
    RecordType.PAYMENT -> Income
    RecordType.CHARGE -> ChargeColor
    RecordType.WITHDRAWAL -> WithdrawColor
    RecordType.EXPENSE -> Expense
}

private fun localDate(millis: Long): LocalDate = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate()

/** "Today", "Yesterday" or "Fri, Oct 16". */
fun dayHeader(millis: Long, today: LocalDate = LocalDate.now()): String {
    val day = localDate(millis)
    return when (day) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> day.format(DateTimeFormatter.ofPattern("EEE, MMM d", Locale.getDefault()))
    }
}

/** "Oct 18, 2026" */
fun fullDate(millis: Long): String = localDate(millis).format(DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault()))

/** Signed money text: "+₱100.00" or "−₱6.00". */
fun signedMoney(centavos: Long): String = if (centavos >= 0) "+" + Money.format(centavos) else "−" + Money.format(-centavos)

// ---------------------------------------------------------------- Building blocks

@Composable
private fun TypeBadge(type: RecordType) {
    Box(
        Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(type.color().copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(type.glyph(), color = type.color(), fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

@Composable
private fun StatusTag(text: String, color: Color) {
    Text(
        text,
        color = color,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

private val PendingColor = Color(0xFFB45309)

/** One ledger line. Used on the Ledger tab and in "Recent" on Home. */
@Composable
fun EntryRow(entry: LedgerEntry, state: ClassUiState, onClick: (() -> Unit)? = null) {
    val paidOut = remember(state.records) { Ledger.paidOutBatchIds(state.records) }
    val (title, subtitle) = when (entry) {
        is LedgerEntry.ChargeBatch -> {
            val each = entry.perMemberCentavos?.let { " × " + Money.format(it) } ?: ""
            val course = state.courses.firstOrNull { it.id == entry.courseId }?.name
            entry.note to ("Charge · ${entry.count} student${if (entry.count == 1) "" else "s"}$each" + (course?.let { " · $it" } ?: ""))
        }
        is LedgerEntry.Single -> {
            val r = entry.record
            when (r.type) {
                RecordType.PAYMENT -> r.memberName to ("Payment" + r.note.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty())
                RecordType.WITHDRAWAL -> r.memberName to ("Withdrawal from balance" + r.note.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty())
                RecordType.EXPENSE -> r.note.ifBlank { "Pay-out" } to ("Paid out from fund" + r.paidTo.takeIf { it.isNotBlank() }?.let { " to $it" }.orEmpty())
                RecordType.CHARGE -> r.note.ifBlank { "Charge" } to "Charge · ${r.memberName}"
            }
        }
    }
    val amount = LedgerView.displayAmount(entry)
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val photoOwner = (entry as? LedgerEntry.Single)?.record?.takeIf { it.memberId.isNotEmpty() }
        if (photoOwner != null && state.avatars[photoOwner.memberId] != null) {
            // The member's photo, with the record type in a small badge on its corner.
            Box {
                Avatar(state.avatars[photoOwner.memberId], photoOwner.memberName, entry.type.color(), size = 38.dp)
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(1.5.dp)
                        .clip(CircleShape)
                        .background(entry.type.color()),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(entry.type.glyph(), color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold, lineHeight = 9.sp)
                }
            }
        } else {
            TypeBadge(entry.type)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(signedMoney(amount), fontWeight = FontWeight.Bold, color = if (amount >= 0) Income else Expense)
            if (entry is LedgerEntry.ChargeBatch) {
                if (entry.batchId in paidOut) StatusTag("Paid out", Income) else StatusTag("Not yet paid out", PendingColor)
            }
        }
    }
}

/** The three fund numbers: Cash on hand, Collected, Charged to members. */
@Composable
fun FundSummaryCard(records: List<LedgerRecord>, title: String? = null) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            if (title != null) {
                Text(title, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
            }
            Text("Cash on hand", color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f))
            Text(Money.format(Ledger.cashOnHand(records)), color = MaterialTheme.colorScheme.onPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SummaryTile("Collected", Ledger.total(records, RecordType.PAYMENT), Modifier.weight(1f))
                SummaryTile("Charged to members", Ledger.total(records, RecordType.CHARGE), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SummaryTile("Waiting to be paid out", Ledger.awaitingPayout(records), Modifier.weight(1f))
                SummaryTile("Available cash", Ledger.availableCash(records), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            val difference = Ledger.booksDifference(records)
            Text(
                if (difference == 0L) "✓ Books balanced"
                else "⚠ Books off by ${Money.format(kotlin.math.abs(difference))}. A record may be missing or entered wrong.",
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun SummaryTile(label: String, centavos: Long, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.14f))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Text(label, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f), style = MaterialTheme.typography.bodySmall, maxLines = 1)
        Text(Money.format(centavos), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
    }
}

/** "Balance ₱26.00", "Owes ₱8.00" or "Settled". */
fun balanceText(centavos: Long): String = when {
    centavos > 0 -> "Balance " + Money.format(centavos)
    centavos < 0 -> "Owes " + Money.format(-centavos)
    else -> "Settled"
}

// ---------------------------------------------------------------- Ledger tab

@Composable
fun LedgerTab(
    state: ClassUiState,
    myUid: String,
    onDeleteRecord: (LedgerRecord) -> Unit,
    onUndoCharge: (LedgerEntry.ChargeBatch) -> Unit,
    onRecordPayout: (String) -> Unit,
) {
    var filterName by rememberSaveable { mutableStateOf(LedgerFilter.ALL.name) }
    val filter = LedgerFilter.valueOf(filterName)
    var selected by remember { mutableStateOf<LedgerEntry?>(null) }
    val entries = remember(state.records, filter, myUid) { LedgerView.filter(state.records, filter, myUid) }

    LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
        item {
            Column(Modifier.padding(16.dp)) {
                FundSummaryCard(state.records)
                Spacer(Modifier.height(10.dp))
                Text(
                    "Your balance: ${balanceText(state.balanceOf(myUid))}",
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(LedgerFilter.entries.toList()) { f ->
                    FilterChip(selected = f == filter, onClick = { filterName = f.name }, label = { Text(f.label) })
                }
            }
        }
        if (entries.isEmpty()) {
            item {
                Text(
                    if (state.records.isEmpty()) "No records yet. Officers with the ledger permission can add one with the + button."
                    else "Nothing here for this filter.",
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                )
            }
        }
        var lastHeader = ""
        entries.forEach { entry ->
            val header = dayHeader(entry.dateMillis)
            if (header != lastHeader) {
                lastHeader = header
                item(key = "h:$header:${entry.key}") {
                    Text(
                        header.uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 2.dp),
                    )
                }
            }
            item(key = entry.key) { EntryRow(entry, state, onClick = { selected = entry }) }
        }
    }

    selected?.let { entry ->
        EntryDetailsDialog(
            entry = entry,
            state = state,
            canManage = state.can(Permission.RECORDS_MANAGE),
            onDismiss = { selected = null },
            onDelete = { record -> selected = null; onDeleteRecord(record) },
            onUndo = { batch -> selected = null; onUndoCharge(batch) },
            onRecordPayout = { batchId -> selected = null; onRecordPayout(batchId) },
        )
    }
}

@Composable
private fun EntryDetailsDialog(
    entry: LedgerEntry,
    state: ClassUiState,
    canManage: Boolean,
    onDismiss: () -> Unit,
    onDelete: (LedgerRecord) -> Unit,
    onUndo: (LedgerEntry.ChargeBatch) -> Unit,
    onRecordPayout: (String) -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    val createdBy: (String) -> String = { uid -> state.members.firstOrNull { it.id == uid }?.name ?: "a former member" }
    val payout = (entry as? LedgerEntry.ChargeBatch)?.let { LedgerView.payoutFor(it.batchId, state.records) }
    // A charge that was paid out cannot be undone, and a single student's share of a charge is not deleted on its own.
    val removable = when (entry) {
        is LedgerEntry.ChargeBatch -> payout == null
        is LedgerEntry.Single -> !(entry.record.type == RecordType.CHARGE && entry.record.batchId.isNotEmpty())
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(if (entry is LedgerEntry.ChargeBatch) "Undo this whole charge?" else "Delete this record?") },
            text = {
                Text(
                    if (entry is LedgerEntry.ChargeBatch) "All ${entry.count} charges of \"${entry.note}\" will be removed and those students' balances go back up."
                    else "This removes the record and updates the balances. It cannot be undone.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    when (entry) {
                        is LedgerEntry.ChargeBatch -> onUndo(entry)
                        is LedgerEntry.Single -> onDelete(entry.record)
                    }
                }) { Text(if (entry is LedgerEntry.ChargeBatch) "Undo charge" else "Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
        return
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(entry.type.label()) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                when (entry) {
                    is LedgerEntry.Single -> {
                        val r = entry.record
                        DetailLine("Amount", Money.format(r.amountCentavos))
                        if (r.memberName.isNotBlank()) DetailLine("Member", r.memberName)
                        if (r.note.isNotBlank()) DetailLine(if (r.type == RecordType.EXPENSE) "For" else "Note", r.note)
                        if (r.paidTo.isNotBlank()) DetailLine("Paid to", r.paidTo)
                        if (r.type == RecordType.EXPENSE) {
                            val charge = LedgerView.chargeFor(r, state.records)
                            DetailLine("Settles", charge?.let { "${it.note} (${it.count} students)" } ?: "A charge that no longer exists")
                        }
                        DetailLine("Date", fullDate(r.dateMillis))
                        if (r.createdByUid.isNotBlank()) DetailLine("Recorded by", createdBy(r.createdByUid))
                        if (r.type == RecordType.CHARGE && r.batchId.isNotEmpty()) {
                            Text(
                                "This is one student's share of a charge. To remove it, undo the whole charge from the All filter.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    is LedgerEntry.ChargeBatch -> {
                        DetailLine("Description", entry.note)
                        entry.perMemberCentavos?.let { DetailLine("Per student", Money.format(it)) }
                        DetailLine("Students", entry.count.toString())
                        DetailLine("Total", Money.format(entry.totalCentavos))
                        state.courses.firstOrNull { it.id == entry.courseId }?.let { DetailLine("Course", it.name) }
                        DetailLine("Date", fullDate(entry.dateMillis))
                        entry.records.first().createdByUid.takeIf { it.isNotBlank() }?.let { DetailLine("Recorded by", createdBy(it)) }
                        DetailLine(
                            "Status",
                            payout?.let { "Paid out ${fullDate(it.dateMillis)}" + it.paidTo.takeIf { p -> p.isNotBlank() }?.let { p -> " to $p" }.orEmpty() }
                                ?: "Not yet paid out",
                        )
                        HorizontalDivider(Modifier.padding(vertical = 4.dp))
                        Text("Charged", fontWeight = FontWeight.Bold)
                        entry.records.forEach { Text("• ${it.memberName}  ${Money.format(it.amountCentavos)}", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        },
        confirmButton = {
            Row {
                if (canManage && entry is LedgerEntry.ChargeBatch && payout == null) {
                    TextButton(onClick = { onRecordPayout(entry.batchId) }) { Text("Record pay-out") }
                }
                TextButton(onClick = onDismiss) { Text("Close") }
            }
        },
        dismissButton = {
            if (canManage && removable) {
                TextButton(onClick = { confirming = true }) {
                    Text(if (entry is LedgerEntry.ChargeBatch) "Undo charge" else "Delete", color = MaterialTheme.colorScheme.error)
                }
            }
        },
    )
}

@Composable
private fun DetailLine(label: String, value: String) {
    Row {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(100.dp))
        Text(value, fontWeight = FontWeight.SemiBold)
    }
}

/** The four kinds of record the + button offers. */
@Composable
fun AddRecordChooser(onPick: (RecordType) -> Unit, onDismiss: () -> Unit) {
    val options = listOf(
        RecordType.PAYMENT to "A student pays money in.",
        RecordType.CHARGE to "Deduct an amount from each student, such as a quiz fee. You can charge by course.",
        RecordType.WITHDRAWAL to "A student takes part of their balance out.",
        RecordType.EXPENSE to "Pay a charge out in full, for example handing the quiz money to the professor.",
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New record") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                options.forEach { (type, description) ->
                    OutlinedCard(onClick = { onPick(type) }, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            TypeBadge(type)
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(type.label(), fontWeight = FontWeight.Bold)
                                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

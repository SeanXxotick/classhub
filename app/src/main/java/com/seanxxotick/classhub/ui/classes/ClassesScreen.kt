package com.seanxxotick.classhub.ui.classes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.data.model.AppUser
import com.seanxxotick.classhub.data.model.ClassMembership
import com.seanxxotick.classhub.settings.AppSettings
import com.seanxxotick.classhub.ui.common.Avatar
import com.seanxxotick.classhub.ui.common.Initials
import com.seanxxotick.classhub.ui.common.initialsOf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassesScreen(
    user: AppUser,
    classes: List<ClassMembership>?,
    classPhotos: Map<String, String>,
    error: String?,
    onOpenClass: (String) -> Unit,
    onCreate: () -> Unit,
    onJoin: () -> Unit,
    onOpenAccount: () -> Unit,
) {
    var showAdd by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My classes", fontWeight = FontWeight.Bold) },
                actions = { TextButton(onClick = onOpenAccount) { Text("Account") } },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary, onClick = { showAdd = true }) { Text("+  Add a class") }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                classes == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                classes.isEmpty() -> EmptyClasses(user.displayName, error, Modifier.align(Alignment.Center))
                else -> LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        Text(
                            "Signed in as ${user.displayName}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    // Pinned classes first (set in each class's My settings); the order is otherwise unchanged.
                    val pinned = AppSettings.pinnedClasses
                    items(classes.sortedByDescending { it.classId in pinned }, key = { it.classId }) { membership ->
                        ClassRow(membership, classPhotos[membership.classId], membership.classId in pinned, onClick = { onOpenClass(membership.classId) })
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
        }
    }

    if (showAdd) {
        AlertDialog(
            onDismissRequest = { showAdd = false },
            title = { Text("Add a class") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ChoiceCard("Create a class", "For class officers. You become the Class Mayor.") { showAdd = false; onCreate() }
                    ChoiceCard("Join with a code", "For students. Ask your Mayor for the invite code.") { showAdd = false; onJoin() }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { showAdd = false }) { Text("Close") } },
        )
    }
}

@Composable
private fun ClassRow(membership: ClassMembership, photo: String?, pinned: Boolean, onClick: () -> Unit) {
    OutlinedCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(photo, membership.className, MaterialTheme.colorScheme.primary, circle = false)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(membership.className, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (pinned) Text("Pinned", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun ChoiceCard(title: String, subtitle: String, onClick: () -> Unit) {
    OutlinedCard(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun EmptyClasses(name: String, error: String?, modifier: Modifier = Modifier) {
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Hi, $name!", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "You are not in any classes yet. Tap \"Add a class\" to create one or join with a code.",
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        }
    }
}

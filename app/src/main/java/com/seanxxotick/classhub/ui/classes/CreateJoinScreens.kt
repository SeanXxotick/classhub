package com.seanxxotick.classhub.ui.classes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.seanxxotick.classhub.domain.InviteCode
import com.seanxxotick.classhub.ui.common.AccentPicker
import com.seanxxotick.classhub.ui.theme.AccentChoices

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateClassScreen(state: ClassActionState, onCreate: (name: String, description: String, accent: String) -> Unit, onBack: () -> Unit, onClearError: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var accent by rememberSaveable { mutableStateOf(AccentChoices.first()) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Create class", fontWeight = FontWeight.Bold) },
                navigationIcon = { TextButton(onClick = onBack, enabled = !state.busy) { Text("Cancel") } },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it; onClearError() },
                label = { Text("Class name") },
                placeholder = { Text("e.g. BSM CS 3A") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Description (optional)") },
                placeholder = { Text("e.g. 1st Semester, AY 2026-2027") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Accent color", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            AccentPicker(AccentChoices, accent) { accent = it }
            Text(
                "Default roles are created for you: Mayor, Treasurer, Secretary and Member. You can change them later.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { onCreate(name, description, accent) },
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (state.busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(20.dp)) else Text("Create class")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinClassScreen(
    state: ClassActionState,
    initialCode: String,
    preview: ClassesViewModel.InvitePreview?,
    onLookup: (String) -> Unit,
    onJoin: (String) -> Unit,
    onBack: () -> Unit,
    onClearError: () -> Unit,
) {
    var code by rememberSaveable { mutableStateOf(initialCode) }
    // Look the class up as soon as a full code is there (typed, or from an invite link).
    LaunchedEffect(code) { if (code.length == InviteCode.LENGTH) onLookup(code) }
    val className = preview?.takeIf { it.code == code }?.className
    val noMatch = preview != null && preview.code == code && preview.className == null

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Join a class", fontWeight = FontWeight.Bold) },
                navigationIcon = { TextButton(onClick = onBack, enabled = !state.busy) { Text("Cancel") } },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                "Ask your Class Mayor for the ${InviteCode.LENGTH}-character invite code.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = code,
                onValueChange = { input ->
                    code = InviteCode.normalize(input).take(InviteCode.LENGTH)
                    onClearError()
                },
                label = { Text("Invite code") },
                singleLine = true,
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 26.sp, letterSpacing = 6.sp, textAlign = TextAlign.Center),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                modifier = Modifier.fillMaxWidth(),
            )
            if (className != null) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("You are invited to", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(className, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                }
            } else if (noMatch) {
                Text("That code does not match any class. Check it with your Class Mayor.", color = MaterialTheme.colorScheme.error)
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { onJoin(code) },
                enabled = !state.busy && code.length == InviteCode.LENGTH,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (state.busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(20.dp))
                else Text(className?.let { "Join $it" } ?: "Join class")
            }
            Text(
                "You will join as a Member. The Mayor can give you an officer role afterward.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

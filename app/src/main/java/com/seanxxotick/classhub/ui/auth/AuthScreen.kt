package com.seanxxotick.classhub.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.domain.PasswordRules

@Composable
fun AuthScreen(
    state: AuthUiState,
    onSignIn: (String, String) -> Unit,
    onSignUp: (String, String, String) -> Unit,
    onResetPassword: (String) -> Unit,
    onClearError: () -> Unit,
) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var resetting by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Text("ClassHub", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Text(
            if (creating) "Create your account" else "Sign in to your classes",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        if (creating) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it; onClearError() },
                label = { Text("Full name") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = email,
            onValueChange = { email = it; onClearError() },
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; onClearError() },
            label = { Text(if (creating) "Password (at least ${PasswordRules.MIN_LENGTH} characters, with a letter)" else "Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )

        if (!creating) {
            TextButton(
                onClick = { onClearError(); resetting = true },
                enabled = !state.busy,
                modifier = Modifier.align(Alignment.End),
            ) { Text("Forgot password?") }
        }

        if (!resetting) state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }

        Button(
            onClick = { if (creating) onSignUp(name, email, password) else onSignIn(email, password) },
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (state.busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(20.dp))
            else Text(if (creating) "Create account" else "Sign in")
        }
        TextButton(
            onClick = { creating = !creating; onClearError() },
            enabled = !state.busy,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(if (creating) "I already have an account" else "New here? Create an account")
        }
    }

    if (resetting) {
        ResetPasswordDialog(
            initialEmail = email,
            state = state,
            onSend = onResetPassword,
            onClearError = onClearError,
            onClose = { resetting = false; onClearError() },
        )
    }
}

/** Asks for the account email and sends a reset link. After sending, it shows the notice and a Done button. */
@Composable
private fun ResetPasswordDialog(
    initialEmail: String,
    state: AuthUiState,
    onSend: (String) -> Unit,
    onClearError: () -> Unit,
    onClose: () -> Unit,
) {
    var resetEmail by rememberSaveable { mutableStateOf(initialEmail.trim()) }
    val sent = state.notice != null

    AlertDialog(
        onDismissRequest = { if (!state.busy) onClose() },
        title = { Text("Reset your password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (sent) {
                    Text(state.notice.orEmpty(), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Open the link, choose a new password, then come back and sign in with it.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text(
                        "Enter the email you use to sign in. We will send a link to that inbox so you can choose a new password.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = resetEmail,
                        onValueChange = { resetEmail = it; onClearError() },
                        label = { Text("Email") },
                        singleLine = true,
                        enabled = !state.busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        },
        confirmButton = {
            if (sent) {
                TextButton(onClick = onClose) { Text("Done") }
            } else {
                TextButton(onClick = { onSend(resetEmail) }, enabled = !state.busy) {
                    if (state.busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    else Text("Send reset link")
                }
            }
        },
        dismissButton = {
            if (!sent) TextButton(onClick = onClose, enabled = !state.busy) { Text("Cancel") }
        },
    )
}

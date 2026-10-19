package com.seanxxotick.classhub.ui.auth

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.seanxxotick.classhub.R
import com.seanxxotick.classhub.data.model.ContentKind
import com.seanxxotick.classhub.data.model.ScheduleKind
import com.seanxxotick.classhub.domain.ContentIcons
import com.seanxxotick.classhub.domain.NameRules
import com.seanxxotick.classhub.domain.PasswordRules
import com.seanxxotick.classhub.domain.PersonName
import com.seanxxotick.classhub.domain.ScheduleIcons
import com.seanxxotick.classhub.ui.theme.Brand
import com.seanxxotick.classhub.ui.theme.Pending
import com.seanxxotick.classhub.ui.theme.hexToColor
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AuthScreen(
    state: AuthUiState,
    onSignIn: (String, String) -> Unit,
    onSignUp: (PersonName, String, String) -> Unit,
    onResetPassword: (String) -> Unit,
    onClearError: () -> Unit,
) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var resetting by rememberSaveable { mutableStateOf(false) }
    var firstName by rememberSaveable { mutableStateOf("") }
    var middleInitial by rememberSaveable { mutableStateOf("") }
    var lastName by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    val fieldShape = RoundedCornerShape(14.dp)

    // Centered on tall screens; scrolls when the keyboard or a small screen leaves too little room.
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(horizontal = 24.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            // The preview cards step aside while typing, so the form stays in view above the keyboard.
            AnimatedVisibility(
                visible = !WindowInsets.isImeVisible,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically(),
            ) {
                OrbitingPreviews(Modifier.fillMaxWidth().height(250.dp))
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                Text(
                    if (creating) "Create your account" else "Everything your class needs.",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    if (creating) "After signing up, join your class with the invite code from your officers."
                    else "Sign in to see your dues, deadlines and class files.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (creating) {
                OutlinedTextField(
                    value = firstName,
                    onValueChange = { firstName = it.take(NameRules.MAX_PART_LENGTH); onClearError() },
                    label = { Text("First name") },
                    singleLine = true,
                    shape = fieldShape,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = middleInitial,
                        onValueChange = { middleInitial = NameRules.cleanInitial(it); onClearError() },
                        label = { Text("M.I.") },
                        singleLine = true,
                        shape = fieldShape,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next),
                        modifier = Modifier.width(84.dp),
                    )
                    OutlinedTextField(
                        value = lastName,
                        onValueChange = { lastName = it.take(NameRules.MAX_PART_LENGTH); onClearError() },
                        label = { Text("Last name") },
                        singleLine = true,
                        shape = fieldShape,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; onClearError() },
                label = { Text("Email") },
                singleLine = true,
                shape = fieldShape,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; onClearError() },
                label = { Text("Password") },
                supportingText = if (creating) ({ Text("At least ${PasswordRules.MIN_LENGTH} characters, with at least one letter.") }) else null,
                singleLine = true,
                shape = fieldShape,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    TextButton(onClick = { showPassword = !showPassword }) { Text(if (showPassword) "Hide" else "Show") }
                },
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
                onClick = { if (creating) onSignUp(PersonName(firstName, middleInitial, lastName), email, password) else onSignIn(email, password) },
                enabled = !state.busy,
                shape = RoundedCornerShape(27.dp),
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                if (state.busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                else Text(if (creating) "Create account" else "Sign in", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            Row(Modifier.align(Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (creating) "Already have an account?" else "New here?",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
                TextButton(onClick = { creating = !creating; onClearError() }, enabled = !state.busy) {
                    Text(if (creating) "Sign in" else "Create an account", fontWeight = FontWeight.Bold)
                }
            }
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

// ---------------------------------------------------------------- Orbiting preview cards

/** One full lap of the cards, in milliseconds. Slow enough to read every card as it passes. */
private const val ORBIT_MILLIS = 24_000

/** Where the cards rest when the phone's animations are turned off: spread out, none hidden. */
private const val RESTING_ANGLE = 210f

/** False when the user turned animations off in the phone's settings (Remove animations). */
private fun animationsEnabled(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f

/** Width of every orbiting card. Narrow enough that cards are never on top of each other when they swap places. */
private val CARD_WIDTH = 150.dp

/**
 * Three sample cards (a fund total, a deliverable and a new video) that slowly circle a flat oval,
 * like a carousel seen from slightly above: the card at the front is drawn on top and larger, and
 * cards passing behind are smaller and blend into the background. Decoration only, so screen readers skip it.
 *
 * Smoothness: with three cards 120 degrees apart, two cards swap front and back only when they are
 * level with each other, at 30 degrees either side of the oval's sides. The oval is wide enough that
 * they are side by side with a gap then, so the swap is never seen. Fading blends each card toward
 * the background instead of making it see-through, so no card ever shows through another.
 */
@Composable
private fun OrbitingPreviews(modifier: Modifier) {
    val context = LocalContext.current
    val animate = remember { animationsEnabled(context) }
    val transition = rememberInfiniteTransition(label = "orbit")
    val spin by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(ORBIT_MILLIS, easing = LinearEasing)),
        label = "orbitAngle",
    )
    val fadeColor = MaterialTheme.colorScheme.background
    val cardShape = RoundedCornerShape(18.dp)

    // Read only inside the layout and draw lambdas below, so a turning frame does not recompose the cards.
    fun theta(index: Int): Double = Math.toRadians(((if (animate) spin else 0f) + RESTING_ANGLE + index * 120f).toDouble())

    // 0 at the back of the oval (top), 1 at the front (bottom).
    fun depth(index: Int): Float = ((sin(theta(index)) + 1.0) / 2.0).toFloat()

    BoxWithConstraints(modifier.clearAndSetSemantics { }) {
        val density = LocalDensity.current
        val cardWidthPx = with(density) { CARD_WIDTH.toPx() }
        // As wide as the screen allows (cards may reach into the side margin), so level cards stay apart.
        val radiusX = constraints.maxWidth / 2f + with(density) { 12.dp.toPx() } - 0.46f * cardWidthPx
        val radiusY = constraints.maxHeight * 0.28f
        val cards: List<@Composable () -> Unit> = listOf({ FundCard() }, { DueCard() }, { NewVideoCard() })
        cards.forEachIndexed { index, card ->
            // The stacking order: how many cards are further back. It changes only at the moments cards are level.
            val rank by remember { derivedStateOf { cards.indices.count { other -> depth(other) < depth(index) } } }
            Box(
                Modifier
                    .align(Alignment.Center)
                    .zIndex(rank.toFloat())
                    .offset { IntOffset((cos(theta(index)) * radiusX).roundToInt(), (sin(theta(index)) * radiusY).roundToInt()) }
                    .graphicsLayer {
                        val scale = 0.82f + 0.18f * depth(index)
                        scaleX = scale
                        scaleY = scale
                        shape = cardShape
                        clip = true
                    }
                    .drawWithContent {
                        drawContent()
                        // Opaque fade: the further back, the more the card takes on the background color.
                        drawRect(fadeColor, alpha = 0.55f * (1f - depth(index)))
                    },
            ) { card() }
        }
    }
}

@Composable
private fun FundCard() {
    Column(
        Modifier
            .width(CARD_WIDTH)
            .background(Brand)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text("Cash on hand", color = Color(0xFFD9F2EE), fontSize = 11.sp)
        Text("₱1,250.00", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text("✓ Books balanced", color = Color(0xFFD9F2EE), fontSize = 11.sp)
    }
}

@Composable
private fun DueCard() {
    PreviewCard(
        icon = R.drawable.ic_kind_deliverable,
        tint = hexToColor(ScheduleIcons.DEFAULT_COLORS.getValue(ScheduleKind.DEADLINE)),
        title = "Problem Set 4",
        subtitle = "Due tomorrow",
        subtitleColor = Pending,
    )
}

@Composable
private fun NewVideoCard() {
    PreviewCard(
        icon = R.drawable.ic_sched_play,
        tint = hexToColor(ContentIcons.DEFAULT_COLORS.getValue(ContentKind.VIDEO)),
        title = "New recording",
        subtitle = "Chapter 3 video",
    )
}

@Composable
private fun PreviewCard(icon: Int, tint: Color, title: String, subtitle: String, subtitleColor: Color? = null) {
    Row(
        Modifier
            .width(CARD_WIDTH)
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(18.dp))
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
            Text(
                subtitle,
                fontSize = 11.sp,
                fontWeight = if (subtitleColor != null) FontWeight.SemiBold else FontWeight.Normal,
                color = subtitleColor ?: MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

// ---------------------------------------------------------------- Password reset

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

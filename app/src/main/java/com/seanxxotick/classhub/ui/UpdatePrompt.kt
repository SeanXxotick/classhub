package com.seanxxotick.classhub.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.pm.PackageInfoCompat
import com.seanxxotick.classhub.data.repository.UpdateRepository
import com.seanxxotick.classhub.domain.UpdateNotice
import com.seanxxotick.classhub.domain.UpdateRules

/** Tells the student when a newer version of the app has been published. Checked once each time the app opens. */
@Composable
fun UpdatePrompt() {
    val context = LocalContext.current
    var notice by rememberSaveable { mutableStateOf<UpdateNotice?>(null) }
    var later by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (notice != null) return@LaunchedEffect
        val installed = runCatching {
            PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0)).toInt()
        }.getOrNull() ?: return@LaunchedEffect
        notice = UpdateRules.check(installed, UpdateRepository().latest())
    }

    val current = notice ?: return
    val required = current is UpdateNotice.Required
    if (later && !required) return
    val release = current.release

    AlertDialog(
        // A required update cannot be dismissed by tapping outside or pressing Back.
        onDismissRequest = { if (!required) later = true },
        title = { Text(if (required) "Update required" else "Update available") },
        text = {
            Text(
                buildString {
                    append("ClassHub ${release.versionName} is ready.")
                    if (required) append(" This version is too old to keep working, so please update to continue.")
                    if (release.notes.isNotBlank()) append("\n\nWhat is new:\n${release.notes}")
                },
            )
        },
        confirmButton = {
            TextButton(onClick = {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(release.downloadUrl))) }
            }) { Text("Update") }
        },
        dismissButton = { if (!required) TextButton(onClick = { later = true }) { Text("Later") } },
    )
}

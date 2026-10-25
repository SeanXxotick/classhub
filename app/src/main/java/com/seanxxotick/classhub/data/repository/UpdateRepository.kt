package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.domain.AppRelease
import kotlinx.coroutines.tasks.await

/** Reads which app version is the newest. Only the admin scripts can change it. */
class UpdateRepository(db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private val latest = db.collection("appConfig").document("latest")

    /** The newest release, or null when offline or none is published; a failed check must never get in the way. */
    suspend fun latest(): AppRelease? =
        runCatching { latest.get().await().toObject(AppRelease::class.java) }.getOrNull()
}

package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

/**
 * Profile pictures (avatars/{uid}) and class pictures (classPhotos/{classId}).
 * Each is a small square JPEG stored as Base64 text in one document, so no file storage service is needed.
 */
class PhotoRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private val avatars = db.collection("avatars")
    private val classPhotos = db.collection("classPhotos")

    /** Live photo of one user or class, or null when there is none. */
    private fun photoFlow(doc: com.google.firebase.firestore.DocumentReference): Flow<String?> = callbackFlow {
        val registration = doc.addSnapshotListener { snapshot, error ->
            if (error != null) {
                trySend(null)
                return@addSnapshotListener
            }
            trySend(snapshot?.getString("photo"))
        }
        awaitClose { registration.remove() }
    }

    fun observeAvatar(uid: String): Flow<String?> = photoFlow(avatars.document(uid))

    /** Photos of many users at once, as uid to photo. Users without a photo are left out. */
    fun observeAvatars(uids: List<String>): Flow<Map<String, String>> {
        val ids = uids.distinct().filter { it.isNotEmpty() }
        if (ids.isEmpty()) return flowOf(emptyMap())
        // Firestore allows up to 30 ids per "in" query, so larger classes are split into chunks.
        val chunks = ids.chunked(30).map { chunk ->
            callbackFlow {
                val registration = avatars.whereIn(FieldPath.documentId(), chunk).addSnapshotListener { snapshot, error ->
                    if (error != null) {
                        trySend(emptyMap())
                        return@addSnapshotListener
                    }
                    val photos = snapshot?.documents.orEmpty()
                        .mapNotNull { doc -> doc.getString("photo")?.let { doc.id to it } }
                        .toMap()
                    trySend(photos)
                }
                awaitClose { registration.remove() }
            }
        }
        return combine(chunks) { parts -> parts.fold(emptyMap()) { acc, part -> acc + part } }
    }

    suspend fun setAvatar(uid: String, photo: String) {
        avatars.document(uid).set(mapOf("photo" to photo, "updatedAtMillis" to System.currentTimeMillis())).await()
    }

    suspend fun removeAvatar(uid: String) {
        avatars.document(uid).delete().await()
    }

    fun observeClassPhoto(classId: String): Flow<String?> = photoFlow(classPhotos.document(classId))

    /** Photos of the user's classes, as classId to photo. Each class is read on its own, since only members may read it. */
    fun observeClassPhotos(classIds: List<String>): Flow<Map<String, String>> {
        val ids = classIds.distinct().filter { it.isNotEmpty() }
        if (ids.isEmpty()) return flowOf(emptyMap())
        return combine(ids.map { id -> photoFlowWithId(id) }) { pairs -> pairs.filterNotNull().toMap() }
    }

    private fun photoFlowWithId(classId: String): Flow<Pair<String, String>?> = callbackFlow {
        val registration = classPhotos.document(classId).addSnapshotListener { snapshot, _ ->
            trySend(snapshot?.getString("photo")?.let { classId to it })
        }
        awaitClose { registration.remove() }
    }

    suspend fun setClassPhoto(classId: String, photo: String) {
        classPhotos.document(classId).set(mapOf("photo" to photo, "updatedAtMillis" to System.currentTimeMillis())).await()
    }

    suspend fun removeClassPhoto(classId: String) {
        classPhotos.document(classId).delete().await()
    }
}

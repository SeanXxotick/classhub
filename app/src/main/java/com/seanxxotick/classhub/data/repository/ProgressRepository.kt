package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.seanxxotick.classhub.data.model.StudentProgress
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/** Each student's own "done" marks on schedule items. */
class ProgressRepository(
    classId: String,
    db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val progress = db.collection("classes").document(classId).collection("progress")

    /** The signed-in student's done item ids. */
    fun observeMine(uid: String): Flow<Set<String>> =
        progress.document(uid).docFlow<StudentProgress> { p, id -> p.copy(id = id) }
            .map { it?.done?.keys.orEmpty() }

    /** Every student's marks. Only officers who manage the schedule are allowed to read this. */
    fun observeAll(): Flow<List<StudentProgress>> =
        progress.listFlow<StudentProgress> { p, id -> p.copy(id = id) }

    suspend fun markDone(uid: String, itemId: String) {
        progress.document(uid).set(mapOf("done" to mapOf(itemId to System.currentTimeMillis())), SetOptions.merge()).await()
    }

    suspend fun markNotDone(uid: String, itemId: String) {
        progress.document(uid).set(mapOf("done" to mapOf(itemId to FieldValue.delete())), SetOptions.merge()).await()
    }
}

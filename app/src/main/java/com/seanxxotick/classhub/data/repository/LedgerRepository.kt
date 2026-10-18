package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.LedgerRecord
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

class LedgerRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private val records = db.collection("records")

    /** Newest first. Sorted here so Firestore needs no composite index. */
    fun observeRecords(group: Int): Flow<List<LedgerRecord>> =
        records.whereEqualTo("group", group)
            .listFlow<LedgerRecord> { record, id -> record.copy(id = id) }
            .map { list -> list.sortedByDescending { it.dateMillis } }

    suspend fun add(record: LedgerRecord) {
        records.add(record.copy(id = "")).await()
    }

    /** Saves all records together or none of them. A Firestore batch holds up to 500 writes. */
    suspend fun addAll(newRecords: List<LedgerRecord>) {
        require(newRecords.size <= MAX_BATCH) { "Too many records for one batch" }
        val batch = db.batch()
        newRecords.forEach { batch.set(records.document(), it.copy(id = "")) }
        batch.commit().await()
    }

    suspend fun delete(recordId: String) {
        records.document(recordId).delete().await()
    }

    /** Undoes a whole charge: removes every record that shares [batchId]. */
    suspend fun deleteBatch(batchId: String) {
        require(batchId.isNotEmpty()) { "batchId must not be empty" }
        val docs = records.whereEqualTo("batchId", batchId).get().await().documents
        val batch = db.batch()
        docs.forEach { batch.delete(it.reference) }
        batch.commit().await()
    }

    private companion object {
        const val MAX_BATCH = 500
    }
}

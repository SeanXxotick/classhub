package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.ScheduleItem
import com.seanxxotick.classhub.data.model.ScheduleStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

class ScheduleRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private val items = db.collection("schedule")

    /** Soonest first. Items with group 0 apply to the whole class, so the screen filters by group itself. */
    fun observeItems(): Flow<List<ScheduleItem>> =
        items.listFlow<ScheduleItem> { item, id -> item.copy(id = id) }
            .map { list -> list.sortedBy { it.dueMillis } }

    suspend fun add(item: ScheduleItem) {
        items.add(item.copy(id = "")).await()
    }

    suspend fun setStatus(itemId: String, status: ScheduleStatus) {
        items.document(itemId).update("status", status.name).await()
    }

    suspend fun delete(itemId: String) {
        items.document(itemId).delete().await()
    }
}

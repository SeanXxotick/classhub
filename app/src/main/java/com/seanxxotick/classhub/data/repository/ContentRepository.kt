package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.ContentItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.tasks.await

class ContentRepository(
    classId: String,
    db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val contents = db.collection("classes").document(classId).collection("contents")

    fun observeContents(): Flow<List<ContentItem>> =
        contents.listFlow<ContentItem> { item, id -> item.copy(id = id) }

    suspend fun add(item: ContentItem) {
        contents.add(item).await()
    }

    suspend fun update(item: ContentItem) {
        contents.document(item.id).set(item).await()
    }

    suspend fun delete(itemId: String) {
        contents.document(itemId).delete().await()
    }
}

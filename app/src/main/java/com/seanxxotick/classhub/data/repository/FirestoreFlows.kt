package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Live list of documents mapped to [T]. Emits again whenever the collection changes.
 * [withId] copies the Firestore document id into the model.
 */
internal inline fun <reified T : Any> Query.listFlow(crossinline withId: (T, String) -> T): Flow<List<T>> =
    callbackFlow {
        val registration = addSnapshotListener { snapshot, error ->
            if (error != null) {
                close(error)
                return@addSnapshotListener
            }
            val items = snapshot?.documents?.mapNotNull { doc ->
                doc.toObject(T::class.java)?.let { withId(it, doc.id) }
            }.orEmpty()
            trySend(items)
        }
        awaitClose { registration.remove() }
    }

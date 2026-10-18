package com.seanxxotick.classhub.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.AppUser
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class AuthRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val users = db.collection("users")

    /** Emits the signed-in user or null when signed out. A user's role is per class, so it is not part of this. */
    fun observeUser(): Flow<AppUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { firebaseAuth ->
            val current = firebaseAuth.currentUser
            if (current == null) {
                trySend(null)
            } else {
                users.document(current.uid).get()
                    .addOnSuccessListener { doc ->
                        val name = doc.getString("displayName").orEmpty().ifBlank { current.email.orEmpty().substringBefore('@') }
                        trySend(AppUser(uid = current.uid, email = current.email.orEmpty(), displayName = name))
                    }
                    .addOnFailureListener {
                        trySend(AppUser(uid = current.uid, email = current.email.orEmpty(), displayName = current.email.orEmpty().substringBefore('@')))
                    }
            }
        }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    suspend fun signIn(email: String, password: String) {
        auth.signInWithEmailAndPassword(email.trim(), password).await()
    }

    suspend fun signUp(displayName: String, email: String, password: String) {
        val result = auth.createUserWithEmailAndPassword(email.trim(), password).await()
        val uid = result.user?.uid ?: return
        users.document(uid).set(mapOf("displayName" to displayName.trim(), "email" to email.trim())).await()
    }

    fun signOut() = auth.signOut()
}

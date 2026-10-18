package com.seanxxotick.classhub.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.AppUser
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

class AuthRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val users = db.collection("users")

    private fun observeFirebaseUser(): Flow<FirebaseUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    /**
     * Emits the signed-in user or null when signed out. The profile document is watched live,
     * so a name saved just after sign-up still shows up. A user's role is per class, so it is not part of this.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeUser(): Flow<AppUser?> = observeFirebaseUser().flatMapLatest { firebaseUser ->
        if (firebaseUser == null) {
            flowOf(null)
        } else {
            callbackFlow {
                val email = firebaseUser.email.orEmpty()
                val fallbackName = email.substringBefore('@')
                val registration = users.document(firebaseUser.uid).addSnapshotListener { doc, _ ->
                    val name = doc?.getString("displayName").orEmpty().ifBlank { fallbackName }
                    trySend(AppUser(uid = firebaseUser.uid, email = email, displayName = name))
                }
                awaitClose { registration.remove() }
            }
        }
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

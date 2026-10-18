package com.seanxxotick.classhub.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.AppUser
import com.seanxxotick.classhub.data.model.Role
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class AuthRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val users = db.collection("users")

    /** Emits the signed-in user (with their role) or null when signed out. */
    fun observeUser(): Flow<AppUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { firebaseAuth ->
            val current = firebaseAuth.currentUser
            if (current == null) {
                trySend(null)
            } else {
                users.document(current.uid).get()
                    .addOnSuccessListener { doc ->
                        val role = doc.getString("role")?.let { runCatching { Role.valueOf(it) }.getOrNull() } ?: Role.MEMBER
                        trySend(AppUser(uid = current.uid, email = current.email.orEmpty(), role = role))
                    }
                    .addOnFailureListener {
                        trySend(AppUser(uid = current.uid, email = current.email.orEmpty(), role = Role.MEMBER))
                    }
            }
        }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    suspend fun signIn(email: String, password: String) {
        auth.signInWithEmailAndPassword(email.trim(), password).await()
    }

    /** New accounts are always members. Making someone treasurer is done by hand in the Firebase console. */
    suspend fun signUp(email: String, password: String) {
        val result = auth.createUserWithEmailAndPassword(email.trim(), password).await()
        val uid = result.user?.uid ?: return
        users.document(uid).set(mapOf("email" to email.trim(), "role" to Role.MEMBER.name)).await()
    }

    fun signOut() = auth.signOut()
}

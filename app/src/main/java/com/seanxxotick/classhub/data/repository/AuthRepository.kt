package com.seanxxotick.classhub.data.repository

import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.seanxxotick.classhub.data.model.AppUser
import com.seanxxotick.classhub.domain.NameRules
import com.seanxxotick.classhub.domain.PersonName
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
    private val classes = db.collection("classes")

    private fun memberships(uid: String) = users.document(uid).collection("memberships")

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
                    val mustChange = doc?.getBoolean("mustChangePassword") == true
                    trySend(
                        AppUser(
                            uid = firebaseUser.uid,
                            email = email,
                            displayName = name,
                            firstName = doc?.getString("firstName").orEmpty(),
                            middleInitial = doc?.getString("middleInitial").orEmpty(),
                            lastName = doc?.getString("lastName").orEmpty(),
                            mustChangePassword = mustChange,
                        ),
                    )
                }
                awaitClose { registration.remove() }
            }
        }
    }

    suspend fun signIn(email: String, password: String) {
        auth.signInWithEmailAndPassword(email.trim(), password).await()
    }

    suspend fun signUp(name: PersonName, email: String, password: String) {
        val result = auth.createUserWithEmailAndPassword(email.trim(), password).await()
        val uid = result.user?.uid ?: return
        val parts = NameRules.cleaned(name)
        users.document(uid).set(
            mapOf(
                "displayName" to NameRules.display(parts),
                "firstName" to parts.first,
                "middleInitial" to parts.middleInitial,
                "lastName" to parts.last,
                "email" to email.trim(),
            ),
        ).await()
    }

    /** Sets a new password for the signed-in user and clears the "must change password" flag. */
    suspend fun changePassword(newPassword: String) {
        val user = auth.currentUser ?: error("You are signed out. Sign in again first.")
        user.updatePassword(newPassword).await()
        users.document(user.uid).set(mapOf("mustChangePassword" to false), SetOptions.merge()).await()
    }

    /**
     * Asks Firebase to email a password reset link. An unknown email is treated as sent, so the app
     * never reveals which emails have accounts.
     */
    suspend fun sendPasswordReset(email: String) {
        try {
            auth.sendPasswordResetEmail(email.trim()).await()
        } catch (_: FirebaseAuthInvalidUserException) {
        }
    }

    /**
     * Saves a new name on the profile and on the member entry of every class the user is in,
     * all in one batch so the name never differs between classes.
     */
    suspend fun updateName(name: PersonName) {
        val uid = auth.currentUser?.uid ?: error("You are signed out. Sign in again first.")
        val parts = NameRules.cleaned(name)
        val display = NameRules.display(parts)
        val memberEntries = memberships(uid).get().await().documents.map { classes.document(it.id).collection("members").document(uid) }
        val batch = db.batch()
        batch.set(
            users.document(uid),
            mapOf("displayName" to display, "firstName" to parts.first, "middleInitial" to parts.middleInitial, "lastName" to parts.last),
            SetOptions.merge(),
        )
        // Only entries that still exist and show a different name: classes the user was removed from are skipped.
        memberEntries.forEach { entry ->
            val current = runCatching { entry.get().await() }.getOrNull()
            if (current != null && current.exists() && current.getString("name") != display) batch.update(entry, "name", display)
        }
        batch.commit().await()
    }

    /** Names of the classes where the signed-in user is the Mayor. They must hand those over before deleting their account. */
    suspend fun classesIOwn(): List<String> {
        val uid = auth.currentUser?.uid ?: return emptyList()
        return memberships(uid).get().await().documents.mapNotNull { membership ->
            // A class the user was removed from can no longer be read; they do not own it.
            val room = runCatching { classes.document(membership.id).get().await() }.getOrNull()
            if (room?.getString("ownerUid") == uid) room.getString("name") ?: membership.getString("className") else null
        }
    }

    /**
     * Deletes the signed-in account for good: confirms the password, leaves every class (removing the
     * member entry, membership and done marks), removes the profile and photo, then deletes the sign-in.
     * Ledger records about the student stay, because they are part of the class fund's history.
     */
    suspend fun deleteAccount(password: String) {
        val user = auth.currentUser ?: error("You are signed out. Sign in again first.")
        val email = user.email ?: error("This account has no email, so it cannot be confirmed.")
        user.reauthenticate(EmailAuthProvider.getCredential(email, password)).await()
        val uid = user.uid
        check(classesIOwn().isEmpty()) { "You are still the Mayor of a class. Make someone else the Mayor first." }

        val batch = db.batch()
        memberships(uid).get().await().documents.forEach { membership ->
            val classRef = classes.document(membership.id)
            val member = classRef.collection("members").document(uid)
            // Skip classes the user was already removed from; deleting there would be refused.
            if (runCatching { member.get().await().exists() }.getOrDefault(false)) {
                batch.delete(member)
                batch.delete(classRef.collection("progress").document(uid))
            }
            batch.delete(membership.reference)
        }
        batch.delete(db.collection("avatars").document(uid))
        batch.delete(users.document(uid))
        batch.commit().await()
        user.delete().await()
    }

    fun signOut() = auth.signOut()
}

package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.ClassMembership
import com.seanxxotick.classhub.data.model.ClassRoom
import com.seanxxotick.classhub.data.model.Member
import com.seanxxotick.classhub.data.model.ROLE_MAYOR
import com.seanxxotick.classhub.data.model.ROLE_MEMBER
import com.seanxxotick.classhub.domain.DefaultRoles
import com.seanxxotick.classhub.domain.InviteCode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.security.SecureRandom

class ClassRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private val classes = db.collection("classes")
    private val invites = db.collection("invites")
    private val random = SecureRandom()

    private fun memberships(uid: String) = db.collection("users").document(uid).collection("memberships")

    /** The "My classes" list. */
    fun observeMyClasses(uid: String): Flow<List<ClassMembership>> =
        memberships(uid)
            .listFlow<ClassMembership> { membership, id -> membership.copy(classId = id) }
            .map { list -> list.sortedBy { it.className.lowercase() } }

    fun observeClass(classId: String): Flow<ClassRoom?> =
        classes.document(classId).docFlow<ClassRoom> { room, id -> room.copy(id = id) }

    /**
     * Creates a class with the default roles, makes [ownerUid] its Mayor and publishes an invite code.
     * Everything is written in one batch, so a class is never left half-created.
     */
    suspend fun createClass(
        name: String,
        description: String,
        accentColor: String,
        ownerUid: String,
        ownerName: String,
    ): String {
        val code = uniqueInviteCode()
        val classRef = classes.document()
        val now = System.currentTimeMillis()
        val room = ClassRoom(
            name = name.trim(),
            description = description.trim(),
            ownerUid = ownerUid,
            accentColor = accentColor,
            inviteCode = code,
            defaultRoleId = ROLE_MEMBER,
            createdAtMillis = now,
        )

        val batch = db.batch()
        batch.set(classRef, room)
        DefaultRoles.all().forEach { role ->
            batch.set(classRef.collection("roles").document(role.id), role)
        }
        batch.set(
            classRef.collection("members").document(ownerUid),
            Member(name = ownerName, roleId = ROLE_MAYOR, joinedAtMillis = now),
        )
        batch.set(invites.document(code), inviteData(classRef.id, room.name, room.defaultRoleId))
        batch.set(memberships(ownerUid).document(classRef.id), ClassMembership(className = room.name, joinedAtMillis = now))
        batch.commit().await()
        return classRef.id
    }

    /**
     * Joins the class that owns [rawCode]. New members always start in the class's default role;
     * the security rules enforce that, so nobody can join as an officer.
     * Returns the id of the class that was joined.
     */
    suspend fun joinClass(rawCode: String, uid: String, displayName: String): String {
        val code = InviteCode.normalize(rawCode)
        require(InviteCode.isValid(code)) { "Invite codes have ${InviteCode.LENGTH} letters and numbers." }

        val invite = invites.document(code).get().await()
        require(invite.exists()) { "That code doesn't match any class." }
        val classId = invite.getString("classId").orEmpty()
        val className = invite.getString("className").orEmpty()
        val roleId = invite.getString("defaultRoleId").orEmpty().ifBlank { ROLE_MEMBER }

        val alreadyIn = memberships(uid).document(classId).get().await().exists()
        require(!alreadyIn) { "You're already in $className." }

        val now = System.currentTimeMillis()
        val batch = db.batch()
        batch.set(
            classes.document(classId).collection("members").document(uid),
            mapOf(
                "name" to displayName,
                "roleId" to roleId,
                "joinedAtMillis" to now,
                "excludedCourseIds" to emptyList<String>(),
                "joinCode" to code,
            ),
        )
        batch.set(memberships(uid).document(classId), ClassMembership(className = className, joinedAtMillis = now))
        batch.commit().await()
        return classId
    }

    /** Replaces the class's invite code. The old code stops working; people already in the class stay. */
    suspend fun regenerateInviteCode(room: ClassRoom): String {
        val newCode = uniqueInviteCode()
        val batch = db.batch()
        if (room.inviteCode.isNotEmpty()) batch.delete(invites.document(room.inviteCode))
        batch.set(invites.document(newCode), inviteData(room.id, room.name, room.defaultRoleId))
        batch.update(classes.document(room.id), "inviteCode", newCode)
        batch.commit().await()
        return newCode
    }

    /** Saves class settings and keeps the public invite entry's class name in step. */
    suspend fun updateSettings(room: ClassRoom) {
        val batch = db.batch()
        batch.update(
            classes.document(room.id),
            mapOf(
                "name" to room.name.trim(),
                "description" to room.description.trim(),
                "accentColor" to room.accentColor,
                "ledgerEnabled" to room.ledgerEnabled,
                "scheduleEnabled" to room.scheduleEnabled,
            ),
        )
        if (room.inviteCode.isNotEmpty()) {
            batch.update(invites.document(room.inviteCode), "className", room.name.trim())
        }
        batch.commit().await()
    }

    /** Removes the class from the signed-in user's own list, for example after they were removed from it. */
    suspend fun forgetMembership(uid: String, classId: String) {
        memberships(uid).document(classId).delete().await()
    }

    private fun inviteData(classId: String, className: String, defaultRoleId: String) = mapOf(
        "classId" to classId,
        "className" to className,
        "defaultRoleId" to defaultRoleId,
    )

    private suspend fun uniqueInviteCode(): String {
        repeat(MAX_CODE_TRIES) {
            val code = InviteCode.generate(random)
            if (!invites.document(code).get().await().exists()) return code
        }
        error("Could not generate an unused invite code. Try again.")
    }

    private companion object {
        const val MAX_CODE_TRIES = 5
    }
}

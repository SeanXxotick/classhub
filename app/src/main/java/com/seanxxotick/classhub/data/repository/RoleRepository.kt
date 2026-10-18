package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.Role
import com.seanxxotick.classhub.domain.RoleRules
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

class RoleRepository(
    classId: String,
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val classRef = db.collection("classes").document(classId)
    private val roles = classRef.collection("roles")
    private val members = classRef.collection("members")

    /** Locked roles first (the Mayor), then alphabetical. */
    fun observeRoles(): Flow<List<Role>> =
        roles.listFlow<Role> { role, id -> role.copy(id = id) }
            .map { list -> list.sortedWith(compareByDescending<Role> { it.locked }.thenBy { it.name.lowercase() }) }

    /** Creates a role (blank id) or updates an existing one. Locked roles are refused. */
    suspend fun save(role: Role) {
        require(RoleRules.canEdit(role)) { "The ${role.name} role cannot be changed." }
        val clean = role.copy(permissions = RoleRules.sanitize(role.permissions))
        if (role.id.isEmpty()) roles.add(clean).await() else roles.document(role.id).set(clean).await()
    }

    /** Deletes a role and moves everyone who had it to [defaultRoleId], all in one batch. */
    suspend fun delete(role: Role, defaultRoleId: String) {
        require(RoleRules.canDelete(role, defaultRoleId)) { "The ${role.name} role cannot be deleted." }
        val affected = members.whereEqualTo("roleId", role.id).get().await().documents
        val batch = db.batch()
        affected.forEach { batch.update(it.reference, "roleId", defaultRoleId) }
        batch.delete(roles.document(role.id))
        batch.commit().await()
    }
}

package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.Member
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

class MemberRepository(
    classId: String,
    db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val members = db.collection("classes").document(classId).collection("members")

    fun observeMembers(): Flow<List<Member>> =
        members.listFlow<Member> { member, id -> member.copy(id = id) }
            .map { list -> list.sortedBy { it.name.lowercase() } }

    /** The signed-in user's own membership. Null means they are not (or no longer) in the class. */
    fun observeMember(uid: String): Flow<Member?> =
        members.document(uid).docFlow<Member> { member, id -> member.copy(id = id) }

    suspend fun setRole(uid: String, roleId: String) {
        members.document(uid).update("roleId", roleId).await()
    }

    suspend fun setExcludedCourses(uid: String, courseIds: List<String>) {
        members.document(uid).update("excludedCourseIds", courseIds.distinct()).await()
    }

    suspend fun remove(uid: String) {
        members.document(uid).delete().await()
    }
}

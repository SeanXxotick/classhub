package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.Member
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

class MemberRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private val members = db.collection("members")

    fun observeMembers(group: Int): Flow<List<Member>> =
        members.whereEqualTo("group", group)
            .listFlow<Member> { member, id -> member.copy(id = id) }
            .map { list -> list.sortedBy { it.name.lowercase() } }

    suspend fun add(member: Member) {
        members.add(member.copy(id = "")).await()
    }

    suspend fun delete(memberId: String) {
        members.document(memberId).delete().await()
    }
}

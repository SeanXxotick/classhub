package com.seanxxotick.classhub.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.seanxxotick.classhub.data.model.Course
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

class CourseRepository(
    classId: String,
    db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private val courses = db.collection("classes").document(classId).collection("courses")

    fun observeCourses(): Flow<List<Course>> =
        courses.listFlow<Course> { course, id -> course.copy(id = id) }
            .map { list -> list.sortedBy { it.name.lowercase() } }

    suspend fun add(name: String) {
        courses.add(Course(name = name.trim())).await()
    }

    suspend fun rename(courseId: String, name: String) {
        courses.document(courseId).update("name", name.trim()).await()
    }

    suspend fun delete(courseId: String) {
        courses.document(courseId).delete().await()
    }
}

package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.ContentKind
import com.seanxxotick.classhub.data.model.Course
import java.net.URI

object ContentRules {
    const val MAX_TITLE = 80

    /** Adds "https://" when the link has no scheme, so "drive.google.com/..." works when pasted. */
    fun normalizeUrl(input: String): String {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return trimmed
        return if (trimmed.contains("://")) trimmed else "https://$trimmed"
    }

    /** Only web links (http or https) with a real host name are accepted. */
    fun isValidUrl(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host ?: return false
        return (scheme == "https" || scheme == "http") && host.contains('.') && !host.startsWith('.') && !host.endsWith('.')
    }

    /** Guesses the kind from the link: Google Drive and Docs are files, YouTube is video, anything else is a website. */
    fun guessKind(url: String): ContentKind {
        val host = runCatching { URI(url).host }.getOrNull()?.lowercase().orEmpty()
        return when {
            host.endsWith("drive.google.com") || host.endsWith("docs.google.com") -> ContentKind.FILE
            host.endsWith("youtube.com") || host == "youtu.be" || host.endsWith("vimeo.com") -> ContentKind.VIDEO
            url.substringBefore('?').lowercase().let { path -> FILE_EXTENSIONS.any { path.endsWith(it) } } -> ContentKind.FILE
            else -> ContentKind.WEBSITE
        }
    }

    /** Returns an error message, or null when the item can be saved. */
    fun check(title: String, url: String): String? = when {
        title.isBlank() -> "Give the content a title, for example \"Unit 1 Module 3\"."
        title.trim().length > MAX_TITLE -> "Keep the title under $MAX_TITLE characters."
        url.isBlank() -> "Paste the link, for example a Google Drive share link."
        !isValidUrl(normalizeUrl(url)) -> "That does not look like a web link. Copy the share link from Google Drive or the website."
        else -> null
    }

    /** Matches the search text against the title and the note, ignoring case. */
    fun matches(item: ContentItem, query: String): Boolean {
        val q = query.trim()
        return q.isEmpty() || item.title.contains(q, ignoreCase = true) || item.note.contains(q, ignoreCase = true)
    }

    /**
     * Groups items under their course, in the class's course order, with general material (no course) first.
     * Items whose course was deleted also go under general. Courses with no items are left out.
     */
    fun grouped(items: List<ContentItem>, courses: List<Course>): List<Pair<Course?, List<ContentItem>>> {
        val known = courses.map { it.id }.toSet()
        val general = items.filter { it.courseId.isEmpty() || it.courseId !in known }
        val byCourse = courses.map { course -> course to items.filter { it.courseId == course.id } }
        return (listOf<Pair<Course?, List<ContentItem>>>(null to general) + byCourse)
            .filter { (_, list) -> list.isNotEmpty() }
            .map { (course, list) -> course to list.sortedBy { it.title.lowercase() } }
    }

    private val FILE_EXTENSIONS = listOf(".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".zip")
}

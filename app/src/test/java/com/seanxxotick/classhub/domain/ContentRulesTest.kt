package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ContentItem
import com.seanxxotick.classhub.data.model.ContentKind
import com.seanxxotick.classhub.data.model.Course
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentRulesTest {
    @Test
    fun normalizeUrl_addsHttpsOnlyWhenMissing() {
        assertEquals("https://drive.google.com/file/d/abc", ContentRules.normalizeUrl("  drive.google.com/file/d/abc "))
        assertEquals("http://example.com", ContentRules.normalizeUrl("http://example.com"))
        assertEquals("", ContentRules.normalizeUrl("   "))
    }

    @Test
    fun isValidUrl_acceptsWebLinksOnly() {
        assertTrue(ContentRules.isValidUrl("https://drive.google.com/file/d/abc/view?usp=sharing"))
        assertTrue(ContentRules.isValidUrl("https://youtu.be/xyz"))
        assertFalse(ContentRules.isValidUrl("https://localhost"))
        assertFalse(ContentRules.isValidUrl("ftp://files.example.com/a.pdf"))
        assertFalse(ContentRules.isValidUrl("javascript:alert(1)"))
        assertFalse(ContentRules.isValidUrl("https://not a link"))
        assertFalse(ContentRules.isValidUrl("hello"))
    }

    @Test
    fun guessKind_recognisesDriveYoutubeAndFiles() {
        assertEquals(ContentKind.FILE, ContentRules.guessKind("https://drive.google.com/file/d/abc/view"))
        assertEquals(ContentKind.FILE, ContentRules.guessKind("https://docs.google.com/document/d/abc/edit"))
        assertEquals(ContentKind.VIDEO, ContentRules.guessKind("https://www.youtube.com/watch?v=abc"))
        assertEquals(ContentKind.VIDEO, ContentRules.guessKind("https://youtu.be/abc"))
        assertEquals(ContentKind.FILE, ContentRules.guessKind("https://example.com/notes/module1.PDF?dl=1"))
        assertEquals(ContentKind.WEBSITE, ContentRules.guessKind("https://www.desmos.com/calculator"))
    }

    @Test
    fun check_needsATitleAndAValidLink() {
        assertNotNull(ContentRules.check(" ", "https://drive.google.com/x"))
        assertNotNull(ContentRules.check("x".repeat(81), "https://drive.google.com/x"))
        assertNotNull(ContentRules.check("Module 1", ""))
        assertNotNull(ContentRules.check("Module 1", "not a link"))
        assertNull(ContentRules.check("Module 1", "drive.google.com/file/d/abc"))
    }

    @Test
    fun matches_searchesTitleAndNote_ignoringCase() {
        val item = ContentItem(title = "Unit 1 Module 3 - AdCal", note = "Laplace transform")
        assertTrue(ContentRules.matches(item, "module 3"))
        assertTrue(ContentRules.matches(item, "LAPLACE"))
        assertTrue(ContentRules.matches(item, "  "))
        assertFalse(ContentRules.matches(item, "geometry"))
    }

    @Test
    fun grouped_putsGeneralFirst_thenCoursesInOrder_skippingEmptyOnes() {
        val courses = listOf(Course("adcal", "Advanced Calculus I"), Course("or", "Operations Research"), Course("mg", "Modern Geometry"))
        val items = listOf(
            ContentItem(id = "1", courseId = "or", title = "B quiz reviewer"),
            ContentItem(id = "2", courseId = "", title = "Class calendar"),
            ContentItem(id = "3", courseId = "adcal", title = "Syllabus"),
            ContentItem(id = "4", courseId = "or", title = "A lecture notes"),
            ContentItem(id = "5", courseId = "deleted-course", title = "Old file"),
        )
        val groups = ContentRules.grouped(items, courses)
        assertEquals(listOf(null, "adcal", "or"), groups.map { it.first?.id })
        assertEquals(listOf("2", "5"), groups[0].second.map { it.id })
        assertEquals(listOf("4", "1"), groups[2].second.map { it.id })
    }
}

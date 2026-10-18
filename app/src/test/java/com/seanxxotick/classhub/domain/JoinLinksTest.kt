package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JoinLinksTest {
    @Test
    fun linkFor_buildsTheWebLink_withANormalizedCode() {
        assertEquals("https://classhub-975eb.web.app/join/K7M4QX", JoinLinks.linkFor(" k7m-4qx "))
    }

    @Test
    fun codeFrom_readsWebLinks() {
        assertEquals("K7M4QX", JoinLinks.codeFrom("https://classhub-975eb.web.app/join/K7M4QX"))
        assertEquals("K7M4QX", JoinLinks.codeFrom("https://classhub-975eb.web.app/join/k7m4qx/"))
        assertEquals("K7M4QX", JoinLinks.codeFrom("https://CLASSHUB-975EB.web.app/Join/K7M4QX?utm_source=messenger"))
    }

    @Test
    fun codeFrom_readsTheAppSchemeFallback() {
        assertEquals("K7M4QX", JoinLinks.codeFrom("classhub://join/K7M4QX"))
    }

    @Test
    fun codeFrom_rejectsOtherSitesPathsAndBadCodes() {
        assertNull(JoinLinks.codeFrom("https://evil.example.com/join/K7M4QX"))
        assertNull(JoinLinks.codeFrom("https://classhub-975eb.web.app/K7M4QX"))
        assertNull(JoinLinks.codeFrom("https://classhub-975eb.web.app/join/K7M4QX/extra"))
        assertNull(JoinLinks.codeFrom("https://classhub-975eb.web.app/join/K7M4Q0"))
        assertNull(JoinLinks.codeFrom("https://classhub-975eb.web.app/join/"))
        assertNull(JoinLinks.codeFrom("mailto:someone@example.com"))
        assertNull(JoinLinks.codeFrom("not a link"))
    }

    @Test
    fun shareText_includesTheLinkAndTheCode_withoutContractions() {
        val text = JoinLinks.shareText("BSM CS 3A", "K7M4QX")
        assertTrue(text.contains("https://classhub-975eb.web.app/join/K7M4QX"))
        assertTrue(text.contains("enter K7M4QX"))
        assertFalse(Regex("\\b\\w+(n't|'re|'ll|'ve|'m|'d)\\b").containsMatchIn(text))
    }
}

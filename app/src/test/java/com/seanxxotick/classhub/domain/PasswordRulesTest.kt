package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class PasswordRulesTest {
    private val email = "jdelacruz2026@school.edu"

    @Test
    fun aGoodPassword_isAccepted() {
        assertNull(PasswordRules.check("ClassHub2026", "ClassHub2026", email))
    }

    @Test
    fun tooShort_isRejected() {
        assertEquals("Use at least 8 characters.", PasswordRules.check("abc123", "abc123", email))
    }

    @Test
    fun numbersOnly_isRejected() {
        assertEquals("Include at least one letter, so it is not just numbers.", PasswordRules.check("12345678", "12345678", email))
    }

    @Test
    fun theFirstPartOfTheEmail_isRejected_ignoringCase() {
        assertEquals(
            "Do not use the first part of your email as your password. It is too easy to guess.",
            PasswordRules.check("JDelaCruz2026", "JDelaCruz2026", email),
        )
    }

    @Test
    fun strength_ignoresTheConfirmation() {
        assertNull(PasswordRules.strength("ClassHub2026", email))
        assertEquals("Use at least 8 characters.", PasswordRules.strength("abc", email))
    }

    @Test
    fun aMismatchedConfirmation_isRejected() {
        assertEquals("The two passwords do not match.", PasswordRules.check("ClassHub2026", "ClassHub2025", email))
    }

    @Test
    fun messages_useNoContractions() {
        val messages = listOf(
            PasswordRules.check("a", "a", email),
            PasswordRules.check("12345678", "12345678", email),
            PasswordRules.check("ClassHub2026", "x", email),
            PasswordRules.check("jdelacruz2026", "jdelacruz2026", email),
        )
        val contraction = Regex("\\b\\w+(n't|'re|'ll|'ve|'m|'d)\\b")
        messages.forEach { assertFalse(it.orEmpty(), contraction.containsMatchIn(it.orEmpty())) }
    }
}

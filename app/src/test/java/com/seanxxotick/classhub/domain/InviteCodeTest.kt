package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class InviteCodeTest {
    @Test
    fun generate_makesSixValidCharacters() {
        val random = Random(42)
        repeat(200) {
            val code = InviteCode.generate(random)
            assertEquals(InviteCode.LENGTH, code.length)
            assertTrue("$code should be valid", InviteCode.isValid(code))
        }
    }

    @Test
    fun generate_neverUsesConfusingCharacters() {
        val random = Random(7)
        val all = List(500) { InviteCode.generate(random) }.joinToString("")
        listOf('0', 'O', '1', 'I').forEach { assertFalse("found $it", it in all) }
    }

    @Test
    fun generate_isRepeatableForTheSameSeed_andDiffersAcrossSeeds() {
        assertEquals(InviteCode.generate(Random(1)), InviteCode.generate(Random(1)))
        assertNotEquals(InviteCode.generate(Random(1)), InviteCode.generate(Random(2)))
    }

    @Test
    fun normalize_forgivesCaseSpacesAndDashes() {
        assertEquals("K7M4QX", InviteCode.normalize(" k7m-4qx "))
        assertEquals("K7M4QX", InviteCode.normalize("k7m 4qx"))
    }

    @Test
    fun isValid_rejectsWrongLengthAndBadCharacters() {
        assertTrue(InviteCode.isValid("K7M4QX"))
        assertFalse(InviteCode.isValid("K7M4Q"))
        assertFalse(InviteCode.isValid("K7M4QXX"))
        assertFalse(InviteCode.isValid("K7M4Q0"))
        assertFalse(InviteCode.isValid("k7m4qx"))
        assertFalse(InviteCode.isValid(""))
    }
}

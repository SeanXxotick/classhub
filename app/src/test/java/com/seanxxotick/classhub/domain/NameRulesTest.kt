package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NameRulesTest {
    @Test
    fun display_putsTheInitialBetweenFirstAndLast() {
        assertEquals("Juan D. Dela Cruz", NameRules.display(PersonName("Juan", "d", "Dela Cruz")))
    }

    @Test
    fun display_withoutInitial_skipsIt() {
        assertEquals("Juan Dela Cruz", NameRules.display(PersonName("  Juan ", "", "Dela  Cruz")))
    }

    @Test
    fun split_usesTheInitialAsTheDivider() {
        assertEquals(PersonName("Maria Clara", "S", "Dela Cruz"), NameRules.split("Maria Clara S. Dela Cruz"))
    }

    @Test
    fun split_withoutInitial_takesTheLastWordAsLastName() {
        assertEquals(PersonName("Maria Clara", "", "Santos"), NameRules.split("Maria Clara Santos"))
    }

    @Test
    fun split_oneWord_isTheFirstName() {
        assertEquals(PersonName("juan"), NameRules.split("juan"))
    }

    @Test
    fun split_thenDisplay_givesTheSameName() {
        val name = "Jose P. Rizal"
        assertEquals(name, NameRules.display(NameRules.split(name)))
    }

    @Test
    fun check_requiresFirstAndLast() {
        assertEquals("Enter your first name.", NameRules.check(PersonName(" ", "", "Cruz")))
        assertEquals("Enter your last name.", NameRules.check(PersonName("Juan", "", "")))
        assertNull(NameRules.check(PersonName("Juan", "", "Cruz")))
    }

    @Test
    fun check_initialMustBeALetter() {
        assertEquals("The middle initial must be letters only.", NameRules.check(PersonName("Juan", "4", "Cruz")))
    }

    @Test
    fun display_twoLetterInitial_getsAPeriodAfterEachLetter() {
        assertEquals("Juan D.C. Santos", NameRules.display(PersonName("Juan", "dc", "Santos")))
    }

    @Test
    fun split_findsATwoLetterInitial_writtenEitherWay() {
        assertEquals(PersonName("Juan", "DC", "Santos"), NameRules.split("Juan D.C. Santos"))
        assertEquals(PersonName("Juan", "DC", "Santos"), NameRules.split("Juan DC. Santos"))
    }

    @Test
    fun cleanInitial_keepsAtMostTwoLetters() {
        assertEquals("DC", NameRules.cleanInitial("d.c.x"))
    }

    @Test
    fun cleaned_keepsOneCapitalLetterForTheInitial() {
        assertEquals(PersonName("Juan", "D", "Cruz"), NameRules.cleaned(PersonName(" Juan", "d.", "Cruz ")))
    }
}

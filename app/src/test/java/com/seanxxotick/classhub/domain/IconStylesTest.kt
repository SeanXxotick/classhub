package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ContentKind
import com.seanxxotick.classhub.data.model.ScheduleKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IconStylesTest {
    private val none = emptyMap<String, String>()

    @Test
    fun scheduleDefaults_areTheOriginalIconsAndColors() {
        assertEquals("document", ScheduleIcons.iconFor(ScheduleKind.DEADLINE, none))
        assertEquals("pencil", ScheduleIcons.iconFor(ScheduleKind.QUIZ, none))
        assertEquals("clipboard", ScheduleIcons.iconFor(ScheduleKind.EXAM, none))
        assertEquals("mic", ScheduleIcons.iconFor(ScheduleKind.RECITATION, none))
        assertEquals("flag", ScheduleIcons.iconFor(ScheduleKind.FCO, none))
        assertEquals("#B91C1C", ScheduleIcons.colorFor(ScheduleKind.EXAM, none))
        assertEquals("#7C3AED", ScheduleIcons.colorFor(ScheduleKind.FCO, none))
    }

    @Test
    fun contentDefaults_areFilePlayAndGlobe() {
        assertEquals("file", ContentIcons.iconFor(ContentKind.FILE, none))
        assertEquals("play", ContentIcons.iconFor(ContentKind.VIDEO, none))
        assertEquals("globe", ContentIcons.iconFor(ContentKind.WEBSITE, none))
        assertEquals("#DC2626", ContentIcons.colorFor(ContentKind.VIDEO, none))
    }

    @Test
    fun aChoice_replacesTheDefault_onlyForThatType() {
        val icons = mapOf("QUIZ" to "calculator")
        val colors = mapOf("QUIZ" to "#15803D")
        assertEquals("calculator", ScheduleIcons.iconFor(ScheduleKind.QUIZ, icons))
        assertEquals("clipboard", ScheduleIcons.iconFor(ScheduleKind.EXAM, icons))
        assertEquals("#15803D", ScheduleIcons.colorFor(ScheduleKind.QUIZ, colors))
        assertEquals("#B91C1C", ScheduleIcons.colorFor(ScheduleKind.EXAM, colors))
    }

    @Test
    fun unknownIconsAndColors_fallBackToDefaults() {
        assertEquals("flag", ScheduleIcons.iconFor(ScheduleKind.FCO, mapOf("FCO" to "rocket")))
        assertEquals("#7C3AED", ScheduleIcons.colorFor(ScheduleKind.FCO, mapOf("FCO" to "#123456")))
        assertEquals("play", ContentIcons.iconFor(ContentKind.VIDEO, mapOf("VIDEO" to "nope")))
    }

    @Test
    fun sanitize_keepsOnlyRealTypesAndAllowedValues_andDropsDefaults() {
        assertEquals(
            mapOf("QUIZ" to "calculator", "RECITATION" to "chat"),
            ScheduleIcons.sanitize(mapOf("QUIZ" to "calculator", "EXAM" to "clipboard", "HOMEWORK" to "book", "FCO" to "rocket", "RECITATION" to "chat")),
        )
        assertEquals(
            mapOf("QUIZ" to "#15803D"),
            ScheduleIcons.sanitizeColors(mapOf("QUIZ" to "#15803D", "EXAM" to "#B91C1C", "FCO" to "#000000")),
        )
        assertEquals(mapOf("FILE" to "link"), ContentIcons.sanitize(mapOf("FILE" to "link", "VIDEO" to "play", "QUIZ" to "star")))
    }

    @Test
    fun theLibraryHasEnoughChoices_noDuplicates_andEveryDefault() {
        assertTrue(IconLibrary.ICONS.size - ScheduleIcons.DEFAULTS.size >= 10)
        assertEquals(IconLibrary.ICONS.size, IconLibrary.ICONS.toSet().size)
        assertEquals(IconLibrary.COLORS.size, IconLibrary.COLORS.toSet().size)
        assertTrue(IconLibrary.ICONS.containsAll(ScheduleIcons.DEFAULTS.values + ContentIcons.DEFAULTS.values))
        assertTrue(IconLibrary.COLORS.containsAll(ScheduleIcons.DEFAULT_COLORS.values + ContentIcons.DEFAULT_COLORS.values))
    }
}

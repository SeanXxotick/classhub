package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.ContentKind
import com.seanxxotick.classhub.data.model.ScheduleKind

/** The icons and colors officers can choose from, shared by the schedule and contents types. */
object IconLibrary {
    /** Every icon key, in the order the picker shows them. */
    val ICONS: List<String> = listOf(
        "document", "pencil", "clipboard", "mic", "flag",
        "play", "file", "globe", "link", "folder", "image",
        "book", "calculator", "laptop", "presentation", "flask", "lightbulb", "group", "star",
        "calendar", "clock", "trophy", "chat", "cap", "ruler", "code", "video",
    )

    /** Color choices as #RRGGBB, including every default color. */
    val COLORS: List<String> = listOf(
        "#3730A3", "#2563EB", "#0369A1", "#0F766E", "#15803D",
        "#CA8A04", "#B45309", "#EA580C", "#B91C1C", "#DC2626",
        "#BE123C", "#DB2777", "#7C3AED", "#A21CAF", "#475569",
    )

    /** The choice for [kindName] when it is allowed, otherwise the default. */
    fun pick(kindName: String, chosen: Map<String, String>, allowed: List<String>, default: String): String =
        chosen[kindName]?.takeIf { it in allowed } ?: default

    /**
     * What gets saved: only known types with allowed values, and nothing for types left on their
     * default (so a later change to a default still reaches those classes).
     */
    fun sanitize(chosen: Map<String, String>, defaults: Map<String, String>, allowed: List<String>): Map<String, String> =
        chosen.filter { (kindName, value) -> kindName in defaults && value in allowed && value != defaults[kindName] }
}

/** Icon and color for each schedule type. Defaults are the original look. */
object ScheduleIcons {
    val ALL: List<String> get() = IconLibrary.ICONS

    val DEFAULTS: Map<ScheduleKind, String> = mapOf(
        ScheduleKind.DEADLINE to "document",
        ScheduleKind.QUIZ to "pencil",
        ScheduleKind.EXAM to "clipboard",
        ScheduleKind.RECITATION to "mic",
        ScheduleKind.FCO to "flag",
    )

    val DEFAULT_COLORS: Map<ScheduleKind, String> = mapOf(
        ScheduleKind.DEADLINE to "#3730A3",
        ScheduleKind.QUIZ to "#B45309",
        ScheduleKind.EXAM to "#B91C1C",
        ScheduleKind.RECITATION to "#0F766E",
        ScheduleKind.FCO to "#7C3AED",
    )

    fun iconFor(kind: ScheduleKind, chosen: Map<String, String>): String =
        IconLibrary.pick(kind.name, chosen, IconLibrary.ICONS, DEFAULTS.getValue(kind))

    fun colorFor(kind: ScheduleKind, chosen: Map<String, String>): String =
        IconLibrary.pick(kind.name, chosen, IconLibrary.COLORS, DEFAULT_COLORS.getValue(kind))

    fun sanitize(chosen: Map<String, String>): Map<String, String> =
        IconLibrary.sanitize(chosen, DEFAULTS.mapKeys { it.key.name }, IconLibrary.ICONS)

    fun sanitizeColors(chosen: Map<String, String>): Map<String, String> =
        IconLibrary.sanitize(chosen, DEFAULT_COLORS.mapKeys { it.key.name }, IconLibrary.COLORS)
}

/** Icon and color for each class contents type. */
object ContentIcons {
    val DEFAULTS: Map<ContentKind, String> = mapOf(
        ContentKind.FILE to "file",
        ContentKind.VIDEO to "play",
        ContentKind.WEBSITE to "globe",
    )

    val DEFAULT_COLORS: Map<ContentKind, String> = mapOf(
        ContentKind.FILE to "#2563EB",
        ContentKind.VIDEO to "#DC2626",
        ContentKind.WEBSITE to "#0F766E",
    )

    fun iconFor(kind: ContentKind, chosen: Map<String, String>): String =
        IconLibrary.pick(kind.name, chosen, IconLibrary.ICONS, DEFAULTS.getValue(kind))

    fun colorFor(kind: ContentKind, chosen: Map<String, String>): String =
        IconLibrary.pick(kind.name, chosen, IconLibrary.COLORS, DEFAULT_COLORS.getValue(kind))

    fun sanitize(chosen: Map<String, String>): Map<String, String> =
        IconLibrary.sanitize(chosen, DEFAULTS.mapKeys { it.key.name }, IconLibrary.ICONS)

    fun sanitizeColors(chosen: Map<String, String>): Map<String, String> =
        IconLibrary.sanitize(chosen, DEFAULT_COLORS.mapKeys { it.key.name }, IconLibrary.COLORS)
}

package com.seanxxotick.classhub.ui.theme

import androidx.compose.ui.graphics.Color

/** Default accent, matching the mockup. Each class can pick its own accent. */
val Brand = Color(0xFF0F766E)
val BrandDark = Color(0xFF0B4F4A)
val BrandLight = Color(0xFF5EC4B6)

val Income = Color(0xFF15803D)
val Expense = Color(0xFFC2410C)
val Pending = Color(0xFFB45309)
val Danger = Color(0xFFB91C1C)

/** Accent choices offered when creating a class or editing its settings. */
val AccentChoices = listOf("#0F766E", "#6366F1", "#DB2777", "#EA580C", "#2563EB", "#7C3AED")

/** "#0F766E" -> Color. Falls back to [fallback] for anything that isn't a valid #RRGGBB value. */
fun hexToColor(hex: String, fallback: Color = Brand): Color {
    val digits = hex.removePrefix("#")
    if (digits.length != 6) return fallback
    val value = digits.toLongOrNull(16) ?: return fallback
    return Color(0xFF000000 or value)
}

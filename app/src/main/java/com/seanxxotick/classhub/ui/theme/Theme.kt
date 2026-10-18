package com.seanxxotick.classhub.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

private val LightColorScheme = lightColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD9F2EE),
    onPrimaryContainer = BrandDark,
    secondary = Color(0xFF475569),
    background = Color(0xFFF6F8FB),
    surface = Color.White,
    surfaceVariant = Color(0xFFEEF1F6),
    onSurfaceVariant = Color(0xFF6B768A),
    error = Danger,
)

private val DarkColorScheme = darkColorScheme(
    primary = BrandLight,
    onPrimary = Color(0xFF00201C),
    primaryContainer = BrandDark,
    onPrimaryContainer = Color(0xFFD9F2EE),
    background = Color(0xFF0F141C),
    surface = Color(0xFF161D27),
    surfaceVariant = Color(0xFF222B37),
    onSurfaceVariant = Color(0xFFA7B1C2),
    error = Color(0xFFF87171),
)

/** Light or dark as chosen in Account (null until the root of the app provides it). */
val LocalDarkTheme = compositionLocalOf<Boolean?> { null }

/** True when the app is showing its dark theme, whether chosen in Account or by the phone. */
@Composable
fun isDarkTheme(): Boolean = LocalDarkTheme.current ?: isSystemInDarkTheme()

data class HeroColors(val container: Color, val content: Color)

/**
 * Colors for the big colored cards (class header, fund and balance cards). Light mode uses the full
 * accent; dark mode blends it into the dark surface so it keeps its hue without glaring.
 */
@Composable
fun heroColors(base: Color = MaterialTheme.colorScheme.primary): HeroColors =
    if (isDarkTheme()) HeroColors(lerp(MaterialTheme.colorScheme.surface, base, 0.30f), Color(0xFFF1F5F9))
    else HeroColors(base, Color.White)

/**
 * App theme. Dynamic (wallpaper) colors are off so the class's accent always shows.
 * [accentHex] overrides the primary color, for example with a class's chosen accent.
 * Nested themes (like a class screen's accent) inherit the user's light or dark choice.
 */
@Composable
fun ClassHubTheme(
    darkTheme: Boolean = LocalDarkTheme.current ?: isSystemInDarkTheme(),
    accentHex: String? = null,
    content: @Composable () -> Unit,
) {
    val base = if (darkTheme) DarkColorScheme else LightColorScheme
    val colorScheme = if (accentHex == null) base else {
        val accent = hexToColor(accentHex)
        base.copy(
            primary = accent,
            onPrimary = Color.White,
            // A solid blend (not transparency), so nothing behind shows through.
            primaryContainer = lerp(base.surface, accent, if (darkTheme) 0.35f else 0.14f),
        )
    }
    MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}

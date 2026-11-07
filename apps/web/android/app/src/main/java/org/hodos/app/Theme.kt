package org.hodos.app

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The single source of truth for the Hodos look. Screens pull these tokens
 * instead of re-declaring near-identical greens and inks, so the app reads as
 * one designed system rather than stitched-together screens.
 */

// Core palette — warm cartographic greens anchored by the golden-hour brand amber.
internal val Ink = Color(0xFF162522)
internal val Forest = Color(0xFF125B48)
internal val Muted = Color(0xFF687C74)
internal val Paper = Color(0xFFF7FAF8)
internal val Mist = Color(0xFFEAF3ED)
internal val Orange = Color(0xFFC47B29)
internal val Danger = Color(0xFFCB4E43)

// Brand amber — same #d97706 the website uses as --accent.
internal val Amber = Color(0xFFD97706)
internal val AmberDeep = Color(0xFFB45309)

// A tight, deliberate type scale: nothing between 11 and 28, one family of
// steps, hierarchy carried by weight and color instead of random sizes.
internal val HodosTypography = Typography(
    displaySmall = TextStyle(
        fontSize = 28.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.6).sp
    ),
    headlineSmall = TextStyle(
        fontSize = 22.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.4).sp
    ),
    titleLarge = TextStyle(
        fontSize = 17.sp,
        lineHeight = 23.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.2).sp
    ),
    titleMedium = TextStyle(
        fontSize = 15.sp,
        lineHeight = 21.sp,
        fontWeight = FontWeight.SemiBold
    ),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
)

@Composable
internal fun HodosTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Forest, onPrimary = Color.White,
            secondary = Ink, background = Paper, onBackground = Ink,
            surface = Color.White, onSurface = Ink,
            surfaceVariant = Mist, onSurfaceVariant = Muted
        ),
        typography = HodosTypography,
        shapes = Shapes(
            small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(18.dp),
            large = RoundedCornerShape(26.dp)
        ),
        content = content
    )
}

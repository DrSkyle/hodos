package org.hodos.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The single source of truth for the Hodos look. One visual language across
 * the app and the website: warm paper, ink, and road-cone amber, with the
 * live map's hazard colors as the only other voices. Overpass carries the
 * type — the road-signage family the website is set in.
 */

// Core light palette — warm paper and ink anchored by brand amber (#d97706).
internal val Ink = Color(0xFF1C1A17)
internal val Paper = Color(0xFFFAF8F2)
internal val PaperRaised = Color(0xFFFFFDF8)
internal val Sand = Color(0xFFF1EDE3)
internal val Line = Color(0xFFE4DFD1)
internal val Muted = Color(0xFF736D61)

// Core dark palette — warm asphalt for night driving without glare.
internal val AsphaltBg = Color(0xFF141311)
internal val AsphaltSurface = Color(0xFF1E1C19)
internal val AsphaltRaised = Color(0xFF272420)
internal val AsphaltLine = Color(0xFF35312B)
internal val AsphaltInk = Color(0xFFFAF8F2)
internal val AsphaltMuted = Color(0xFFA8A295)

// Legacy tinted-surface name; now the warm sand.
internal val Mist = Sand

// Brand amber — the same #d97706 the website uses as --accent.
internal val Amber = Color(0xFFD97706)
internal val AmberDeep = Color(0xFFB45309)

// The live map's hazard & radar language, shared with the website legend.
internal val Healed = Color(0xFF10B981)
internal val Pothole = Color(0xFFE11D48)
internal val Rough = Color(0xFFD97706)
internal val Bump = Color(0xFF7C3AED)
internal val Danger = Color(0xFFE11D48)
internal val PoliceBlue = Color(0xFF2563EB)
internal val JamOrange = Color(0xFFEA580C)
internal val RoadblockRed = Color(0xFFDC2626)
internal val FloodCyan = Color(0xFF0891B2)

// Retained name for the legacy forest-green primary; now resolves to ink so
// older call sites read as the ink-on-paper system without a sweep.
internal val Forest = Ink
internal val Orange = AmberDeep

private val Overpass = FontFamily(
    Font(R.font.overpass_regular, FontWeight.Normal),
    Font(R.font.overpass_semibold, FontWeight.SemiBold),
    Font(R.font.overpass_bold, FontWeight.Bold),
    Font(R.font.overpass_extrabold, FontWeight.ExtraBold)
)

internal val OverpassMono = FontFamily(
    Font(R.font.overpass_mono_regular, FontWeight.Normal),
    Font(R.font.overpass_mono_semibold, FontWeight.SemiBold)
)

// Mono utility voice for measurements, counts, and labels — the data voice.
internal val HodosMono = TextStyle(fontFamily = OverpassMono)

// A tight, deliberate type scale: hierarchy carried by weight and color
// instead of random sizes. Overpass reads wide, so tracking stays gentle.
internal val HodosTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = Overpass,
        fontSize = 28.sp,
        lineHeight = 33.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-0.5).sp
    ),
    headlineSmall = TextStyle(
        fontFamily = Overpass,
        fontSize = 22.sp,
        lineHeight = 27.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-0.35).sp
    ),
    titleLarge = TextStyle(
        fontFamily = Overpass,
        fontSize = 17.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.2).sp
    ),
    titleMedium = TextStyle(
        fontFamily = Overpass,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.SemiBold
    ),
    bodyLarge = TextStyle(fontFamily = Overpass, fontSize = 15.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = Overpass, fontSize = 13.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = Overpass, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = Overpass, fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontFamily = Overpass, fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
    labelSmall = TextStyle(
        fontFamily = OverpassMono,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.8.sp
    )
)

@Composable
internal fun HodosTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colors = if (darkTheme) {
        darkColorScheme(
            primary = AsphaltInk, onPrimary = AsphaltBg,
            secondary = Amber, onSecondary = AsphaltBg,
            background = AsphaltBg, onBackground = AsphaltInk,
            surface = AsphaltSurface, onSurface = AsphaltInk,
            surfaceVariant = AsphaltRaised, onSurfaceVariant = AsphaltMuted,
            error = Danger,
            outline = AsphaltLine
        )
    } else {
        lightColorScheme(
            primary = Ink, onPrimary = Paper,
            secondary = Ink, onSecondary = Paper,
            background = Paper, onBackground = Ink,
            surface = PaperRaised, onSurface = Ink,
            surfaceVariant = Sand, onSurfaceVariant = Muted,
            error = Danger,
            outline = Line
        )
    }
    MaterialTheme(
        colorScheme = colors,
        typography = HodosTypography,
        shapes = Shapes(
            small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(18.dp),
            large = RoundedCornerShape(22.dp)
        ),
        content = content
    )
}

package org.hodos.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * The single source of truth for the Hodos look. One visual language across
 * the app and the website: warm paper, ink, and road-cone amber, with the
 * live map's hazard colors as the only other voices. Overpass carries the
 * type — the road-signage family the website is set in.
 */

// Fixed light palette — blush ground (#fdf1f3), alternate (#f4e8ea), crisp ink (#000000),
// berry primary action (#be185d), and brand amber (#d58400), consistent with the website.
internal val LightInk = Color(0xFF000000)
internal val LightPaper = Color(0xFFFDF1F3)
internal val LightPaperRaised = Color(0xFFFFFFFF)
internal val LightSand = Color(0xFFF4E8EA)
internal val LightLine = Color(0xFFDED2D4)
internal val LightMuted = Color(0xFF50504F)
internal val LightAccentInk = Color(0xFF8A5300)

// Fixed dark palette — deep neutral (#141314) for night driving without glare.
internal val AsphaltBg = Color(0xFF141314)
internal val AsphaltSurface = Color(0xFF1D1B1D)
internal val AsphaltRaised = Color(0xFF252225)
internal val AsphaltLine = Color(0xFF343034)
internal val AsphaltInk = Color(0xFFFCFCFD)
internal val AsphaltMuted = Color(0xFFA6A0A4)
internal val AsphaltAccentInk = Color(0xFFF59E0B)

private var isDarkThemeState by mutableStateOf(false)

/** True while the app is drawing its night palette. Read by the map to pick a style. */
internal val isDarkTheme: Boolean get() = isDarkThemeState

// Theme-reactive palette tokens so every card, surface, and label across the
// app stays WCAG AA high-contrast in both light and dark mode.
internal val Ink: Color get() = if (isDarkThemeState) AsphaltInk else LightInk
internal val Paper: Color get() = if (isDarkThemeState) AsphaltBg else LightPaper
internal val PaperRaised: Color get() = if (isDarkThemeState) AsphaltSurface else LightPaperRaised
internal val Sand: Color get() = if (isDarkThemeState) AsphaltRaised else LightSand
internal val Line: Color get() = if (isDarkThemeState) AsphaltLine else LightLine
internal val Muted: Color get() = if (isDarkThemeState) AsphaltMuted else LightMuted

// Accessible amber text token for small labels.
internal val AccentInk: Color get() = if (isDarkThemeState) AsphaltAccentInk else LightAccentInk

// Legacy tinted-surface name; resolves to active alternate ground.
internal val Mist: Color get() = Sand

// Brand amber (#d58400) and primary action berry (#be185d / #db2777).
internal val Amber = Color(0xFFD58400)
internal val AmberDeep = Color(0xFF8A5300)
internal val Berry = Color(0xFFBE185D)
internal val BerryDark = Color(0xFFDB2777)
internal val OnBerry = Color(0xFFFCFCFD)
internal val ActionFill: Color get() = if (isDarkThemeState) BerryDark else Berry

// The live map's hazard & radar language, shared with the website legend.
internal val Healed = Color(0xFF10B981)
internal val Pothole = Color(0xFFE11D48)
internal val Rough = Color(0xFFD58400)
internal val Bump = Color(0xFF7C3AED)
internal val Danger = Color(0xFFE11D48)
internal val PoliceBlue = Color(0xFF2563EB)
internal val JamOrange = Color(0xFFEA580C)
internal val RoadblockRed = Color(0xFFDC2626)
internal val FloodCyan = Color(0xFF0891B2)

// Retained name for primary ink/action references.
internal val Forest: Color get() = ActionFill
internal val Orange = AmberDeep

/**
 * A soft wash of a hazard color for chips and icons. Derived from the same
 * constants instead of the hard-coded pastels that used to glare in dark mode.
 */
internal fun wash(color: Color): Color = color.copy(alpha = if (isDarkThemeState) 0.18f else 0.12f)

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
// Every Material slot is filled, so nothing falls back to Roboto.
internal val HodosTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = Overpass,
        fontSize = 46.sp,
        lineHeight = 50.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-1.2).sp
    ),
    displayMedium = TextStyle(
        fontFamily = Overpass,
        fontSize = 38.sp,
        lineHeight = 42.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-0.9).sp
    ),
    displaySmall = TextStyle(
        fontFamily = Overpass,
        fontSize = 30.sp,
        lineHeight = 35.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-0.5).sp
    ),
    headlineLarge = TextStyle(
        fontFamily = Overpass,
        fontSize = 30.sp,
        lineHeight = 35.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-0.5).sp
    ),
    headlineMedium = TextStyle(
        fontFamily = Overpass,
        fontSize = 26.sp,
        lineHeight = 31.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = (-0.4).sp
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
        fontSize = 18.sp,
        lineHeight = 23.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.2).sp
    ),
    titleMedium = TextStyle(
        fontFamily = Overpass,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.SemiBold
    ),
    titleSmall = TextStyle(
        fontFamily = Overpass,
        fontSize = 13.sp,
        lineHeight = 18.sp,
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
    isDarkThemeState = darkTheme
    val colors = if (darkTheme) {
        darkColorScheme(
            primary = BerryDark,
            onPrimary = OnBerry,
            primaryContainer = AsphaltRaised,
            onPrimaryContainer = AsphaltInk,
            inversePrimary = Berry,
            secondary = AsphaltAccentInk,
            onSecondary = AsphaltBg,
            secondaryContainer = AsphaltAccentInk.copy(alpha = 0.18f),
            onSecondaryContainer = AsphaltAccentInk,
            tertiary = AsphaltAccentInk,
            onTertiary = AsphaltBg,
            background = AsphaltBg,
            onBackground = AsphaltInk,
            surface = AsphaltSurface,
            onSurface = AsphaltInk,
            surfaceVariant = AsphaltRaised,
            onSurfaceVariant = AsphaltMuted,
            surfaceTint = BerryDark,
            surfaceContainerLowest = Color(0xFF0E0D0E),
            surfaceContainerLow = AsphaltBg,
            surfaceContainer = AsphaltSurface,
            surfaceContainerHigh = AsphaltRaised,
            surfaceContainerHighest = Color(0xFF2E2A2E),
            surfaceBright = Color(0xFF2E2A2E),
            surfaceDim = AsphaltBg,
            inverseSurface = AsphaltInk,
            inverseOnSurface = AsphaltBg,
            error = Danger,
            onError = OnBerry,
            errorContainer = Danger.copy(alpha = 0.18f),
            onErrorContainer = Danger,
            outline = AsphaltLine,
            outlineVariant = AsphaltLine,
            scrim = Color(0xFF000000)
        )
    } else {
        lightColorScheme(
            primary = Berry,
            onPrimary = OnBerry,
            primaryContainer = LightSand,
            onPrimaryContainer = LightInk,
            inversePrimary = BerryDark,
            secondary = AmberDeep,
            onSecondary = OnBerry,
            secondaryContainer = LightSand,
            onSecondaryContainer = LightInk,
            tertiary = AmberDeep,
            onTertiary = OnBerry,
            background = LightPaper,
            onBackground = LightInk,
            surface = LightPaperRaised,
            onSurface = LightInk,
            surfaceVariant = LightSand,
            onSurfaceVariant = LightMuted,
            surfaceTint = Berry,
            surfaceContainerLowest = Color(0xFFFFFFFF),
            surfaceContainerLow = LightPaper,
            surfaceContainer = LightPaperRaised,
            surfaceContainerHigh = LightSand,
            surfaceContainerHighest = Color(0xFFEBDDE0),
            surfaceBright = LightPaperRaised,
            surfaceDim = LightSand,
            inverseSurface = AsphaltBg,
            inverseOnSurface = AsphaltInk,
            error = Danger,
            onError = OnBerry,
            errorContainer = Danger.copy(alpha = 0.12f),
            onErrorContainer = Pothole,
            outline = LightLine,
            outlineVariant = LightLine,
            scrim = LightInk
        )
    }

    // System bars follow the app theme instead of staying cream around a black
    // app (the styles.xml values are the pre-draw default).
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as androidx.activity.ComponentActivity).window
            window.statusBarColor = colors.background.toArgb()
            window.navigationBarColor = colors.background.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colors,
        typography = HodosTypography,
        shapes = Shapes(
            small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(24.dp)
        ),
        content = content
    )
}

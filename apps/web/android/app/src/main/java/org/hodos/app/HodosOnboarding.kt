package org.hodos.app

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs

private val Cream = Color(0xFFF6F3EA)
private val CreamMuted = Color(0xFFB5AFA2)
private val CreamAccent = Color(0xFFD97706)
private val SandMuted = Color(0xFF736D61)
private val SandAccent = Color(0xFFB45309)

private data class IntroStep(
    val index: String,
    val eyebrow: String,
    val title: String,
    val description: String,
    val footnote: String,
    val background: Color,
    val foreground: Color,
    val muted: Color,
    val accent: Color,
    val onDark: Boolean
)

private val steps = listOf(
    IntroStep(
        index = "01",
        eyebrow = "LIVE ROAD MAP",
        title = "Every pothole,\nmapped.",
        description = "Potholes show up crimson, rough stretches amber, speed bumps violet — the same live map in the app and on the web.",
        footnote = "Built for anyone with a phone and a road.",
        background = Forest,
        foreground = Cream,
        muted = CreamMuted,
        accent = CreamAccent,
        onDark = true
    ),
    IntroStep(
        index = "02",
        eyebrow = "HANDS-FREE MAPPING",
        title = "Turn it on.\nKeep going.",
        description = "Hodos runs in the background and pauses when you stop. No buttons to press, no reporting, no new habit to learn.",
        footnote = "Motion is filtered on-device; only compact hazard records sync.",
        background = Paper,
        foreground = Ink,
        muted = SandMuted,
        accent = SandAccent,
        onDark = false
    ),
    IntroStep(
        index = "03",
        eyebrow = "ONE-TIME SETUP",
        title = "Three grants,\none minute.",
        description = "Android needs location, background access, and unrestricted battery so mapping keeps running while you use other apps.",
        footnote = "Raw motion traces stay in RAM and are never uploaded.",
        background = Ink,
        foreground = Cream,
        muted = CreamMuted,
        accent = CreamAccent,
        onDark = true
    )
)

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun HodosOnboarding(
    locationGranted: Boolean,
    backgroundLocationGranted: Boolean,
    batteryUnrestricted: Boolean,
    onRequestLocation: () -> Unit,
    onRequestBackgroundLocation: () -> Unit,
    onRequestBatteryOptimization: () -> Unit,
    onFinishAndEnableAutoMapping: () -> Unit
) {
    val pagerState = rememberPagerState(pageCount = { steps.size })
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val scrollStates = List(steps.size) { rememberScrollState() }
    val page = pagerState.currentPage.coerceIn(0, steps.lastIndex)

    val bgColor by animateColorAsState(steps[page].background, tween(320), label = "onboarding background")
    val fgColor by animateColorAsState(steps[page].foreground, tween(320), label = "onboarding foreground")
    val mutedColor by animateColorAsState(steps[page].muted, tween(320), label = "onboarding muted")
    val accentColor by animateColorAsState(steps[page].accent, tween(320), label = "onboarding accent")
    val onDark = steps[page].onDark
    val buttonBackground = if (onDark) Cream else Forest
    val buttonForeground = if (onDark) Ink else Color.White

    HodosTheme {
        Surface(Modifier.fillMaxSize(), color = bgColor) {
            Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                Column(Modifier.fillMaxSize().padding(bottom = 124.dp)) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Image(
                            painter = painterResource(R.drawable.hodos_brand_icon),
                            contentDescription = "Hodos",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp))
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "hodos",
                            fontSize = 23.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-1.0).sp,
                            color = fgColor
                        )
                        Spacer(Modifier.weight(1f))
                        if (page < steps.lastIndex) {
                            TextButton(onClick = {
                                scope.launch { pagerState.animateScrollToPage(steps.lastIndex) }
                            }) {
                                Text("Skip", color = mutedColor, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    HorizontalPager(
                        state = pagerState,
                        modifier = Modifier.weight(1f)
                    ) { pageIndex ->
                        val offset = pageIndex - (pagerState.currentPage + pagerState.currentPageOffsetFraction)
                        val step = steps[pageIndex]
                        Box(
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = offset * 40.dp.toPx()
                                    alpha = 1f - (abs(offset).coerceIn(0f, 1f) * 0.55f)
                                }
                        ) {
                            Text(
                                step.index,
                                fontSize = 132.sp,
                                lineHeight = 132.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = (-7).sp,
                                color = step.foreground.copy(alpha = 0.07f),
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .offset(x = 14.dp, y = (-6).dp)
                                    .graphicsLayer { translationX = -offset * 70.dp.toPx() }
                            )

                            Column(
                                Modifier
                                    .fillMaxSize()
                                    .verticalScroll(scrollStates[pageIndex])
                                    .padding(horizontal = 28.dp)
                            ) {
                                Spacer(Modifier.height(34.dp))

                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        Modifier
                                            .width(26.dp)
                                            .height(2.dp)
                                            .background(step.accent, RoundedCornerShape(1.dp))
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Text(
                                        step.eyebrow,
                                        fontSize = 10.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        fontFamily = OverpassMono,
                                        letterSpacing = 1.6.sp,
                                        color = step.accent
                                    )
                                }

                                Spacer(Modifier.height(20.dp))

                                Text(
                                    step.title,
                                    fontSize = 40.sp,
                                    lineHeight = 44.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = (-1.2).sp,
                                    color = step.foreground
                                )

                                Spacer(Modifier.height(18.dp))

                                Text(
                                    step.description,
                                    fontSize = 17.sp,
                                    lineHeight = 26.sp,
                                    color = step.muted
                                )

                                if (pageIndex == 0) {
                                    Spacer(Modifier.height(22.dp))
                                    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                        listOf(
                                            Color(0xFFE11D48) to "POTHOLE",
                                            Color(0xFFD97706) to "ROUGH STRETCH",
                                            Color(0xFF7C3AED) to "SPEED BUMP",
                                            Color(0xFF10B981) to "REPAIRED"
                                        ).forEach { (color, label) ->
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Box(
                                                    Modifier.size(9.dp).background(color, CircleShape)
                                                )
                                                Spacer(Modifier.width(10.dp))
                                                Text(
                                                    label,
                                                    fontSize = 10.5.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    fontFamily = OverpassMono,
                                                    letterSpacing = 1.2.sp,
                                                    color = step.muted
                                                )
                                            }
                                        }
                                    }
                                }

                                if (pageIndex == steps.lastIndex) {
                                    Spacer(Modifier.height(30.dp))
                                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                        PermissionRow(
                                            step = 1,
                                            label = "Location & motion",
                                            hint = "Detects road impacts while you drive",
                                            granted = locationGranted,
                                            icon = Icons.Outlined.MyLocation,
                                            onClick = onRequestLocation,
                                            accentColor = step.accent,
                                            foregroundColor = step.foreground,
                                            mutedColor = step.muted,
                                            onDark = step.onDark
                                        )
                                        PermissionRow(
                                            step = 2,
                                            label = "Allow all the time",
                                            hint = "Keeps mapping while Hodos is backgrounded",
                                            granted = backgroundLocationGranted,
                                            icon = Icons.Outlined.Explore,
                                            onClick = onRequestBackgroundLocation,
                                            accentColor = step.accent,
                                            foregroundColor = step.foreground,
                                            mutedColor = step.muted,
                                            onDark = step.onDark
                                        )
                                        PermissionRow(
                                            step = 3,
                                            label = "Unrestricted battery",
                                            hint = "Stops Android from killing the service",
                                            granted = batteryUnrestricted,
                                            icon = Icons.Outlined.BatteryChargingFull,
                                            onClick = onRequestBatteryOptimization,
                                            accentColor = step.accent,
                                            foregroundColor = step.foreground,
                                            mutedColor = step.muted,
                                            onDark = step.onDark
                                        )
                                    }
                                }

                                Spacer(Modifier.height(28.dp))

                                Text(
                                    step.footnote,
                                    fontSize = 12.5.sp,
                                    lineHeight = 18.sp,
                                    color = step.muted.copy(alpha = 0.85f)
                                )

                                if (pageIndex == steps.lastIndex) {
                                    Spacer(Modifier.height(14.dp))
                                    Text(
                                        "Follow @minerva__corporation on Instagram ↗",
                                        fontSize = 12.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = step.accent,
                                        modifier = Modifier.clickable {
                                            val intent = android.content.Intent(
                                                android.content.Intent.ACTION_VIEW,
                                                android.net.Uri.parse(Garage.INSTAGRAM_URL)
                                            )
                                            runCatching { context.startActivity(intent) }
                                        }
                                    )
                                }

                                Spacer(Modifier.height(28.dp))
                            }
                        }
                    }
                }

                Column(
                    Modifier.align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(bgColor)
                        .padding(horizontal = 24.dp, vertical = 16.dp)
                ) {
                    Button(
                        onClick = {
                            if (page == steps.lastIndex) onFinishAndEnableAutoMapping()
                            else scope.launch { pagerState.animateScrollToPage(page + 1) }
                        },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = buttonBackground,
                            contentColor = buttonForeground
                        )
                    ) {
                        Text(
                            if (page == steps.lastIndex) "Enable Automatic Mapping" else "Continue",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(14.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        steps.indices.forEach { i ->
                            val active = i == page
                            val width by animateDpAsState(
                                targetValue = if (active) 26.dp else 8.dp,
                                label = "indicator width"
                            )
                            Box(
                                Modifier.padding(horizontal = 4.dp)
                                    .size(width = width, height = 8.dp)
                                    .background(
                                        if (active) accentColor else fgColor.copy(alpha = 0.22f),
                                        CircleShape
                                    )
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PermissionRow(
    step: Int,
    label: String,
    hint: String,
    granted: Boolean,
    icon: ImageVector,
    onClick: () -> Unit,
    accentColor: Color,
    foregroundColor: Color,
    mutedColor: Color,
    onDark: Boolean
) {
    val container = when {
        granted && onDark -> accentColor.copy(alpha = 0.14f)
        granted -> Mist
        onDark -> Color.White.copy(alpha = 0.06f)
        else -> Color.White
    }
    val border = when {
        granted -> accentColor.copy(alpha = 0.45f)
        onDark -> Color.White.copy(alpha = 0.14f)
        else -> Ink.copy(alpha = 0.10f)
    }
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = container,
        border = BorderStroke(1.dp, border),
        modifier = Modifier
            .fillMaxWidth()
            .height(60.dp)
            .clickable(enabled = !granted, onClick = onClick)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (granted) Icons.Outlined.CheckCircle else icon,
                contentDescription = null,
                tint = accentColor,
                modifier = Modifier.size(20.dp)
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "$step · $label",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = foregroundColor
                )
                Text(
                    if (granted) "Allowed" else hint,
                    fontSize = 12.sp,
                    color = mutedColor
                )
            }
        }
    }
}

package org.hodos.app

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
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
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs

// Map-legend colors, reused so onboarding dots match the live map exactly.
private val PinCrimson = Color(0xFFE11D48)
private val PinViolet = Color(0xFF7C3AED)
private val PinEmerald = Color(0xFF10B981)

private data class IntroStep(
    val eyebrow: String,
    val title: String,
    val description: String,
    val highlightTitle: String,
    val highlightSub: String,
    val icon: ImageVector
)

private val steps = listOf(
    IntroStep(
        eyebrow = "01 · LIVE ROAD MAP",
        title = "Every pothole, mapped.",
        description = "Potholes show up crimson, rough stretches amber, speed bumps violet. The same live map runs in the app and on the web.",
        highlightTitle = "Built for Pathao, inDrive & daily commuters",
        highlightSub = "Save your suspension, tires, and brakes on every shift.",
        icon = Icons.Outlined.Explore
    ),
    IntroStep(
        eyebrow = "02 · HANDS-FREE MAPPING",
        title = "Turn it on. Keep riding.",
        description = "Hodos runs in the background while you ride and pauses when you stop. Riders who map a lot unlock Pit-Stop service discounts and a share of sponsorship revenue.",
        highlightTitle = "Zero tapping while driving",
        highlightSub = "Motion is filtered on-device; only compact hazard records sync.",
        icon = Icons.Outlined.DirectionsCar
    ),
    IntroStep(
        eyebrow = "03 · ONE-TIME SETUP",
        title = "Three grants, one minute.",
        description = "Android needs location, background access, and unrestricted battery so mapping keeps running while you navigate in Pathao, inDrive, or Google Maps.",
        highlightTitle = "On-device sensor processing",
        highlightSub = "Raw motion traces stay in RAM and are never uploaded.",
        icon = Icons.Outlined.VerifiedUser
    )
)

/**
 * The hand-drawn road motif: an S-curve road that draws itself in when the
 * page settles, hazard pins popping up along the path, and the golden-hour
 * house waiting at the end — the same story as the brand icon.
 */
@Composable
private fun RoadMotif(
    variant: Int,
    active: Boolean,
    modifier: Modifier = Modifier
) {
    val progress by animateFloatAsState(
        targetValue = if (active) 1f else 0.5f,
        animationSpec = tween(durationMillis = 950, easing = LinearEasing),
        label = "road draw-in"
    )
    val pulse = rememberInfiniteTransition(label = "detect pulse")
    val pulseT by pulse.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "detect pulse t"
    )

    Canvas(modifier = modifier) {
        val corner = 22.dp.toPx()
        // Card
        drawRoundRect(
            color = Color.White,
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(corner)
        )
        drawRoundRect(
            color = Ink.copy(alpha = 0.07f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(corner),
            style = Stroke(width = 1.dp.toPx())
        )

        // Winding road from bottom-left to top-right, sampled manually so the
        // draw-in dash length and every pin position stay exact.
        fun pt(fx: Float, fy: Float) = Offset(size.width * fx, size.height * fy)
        val c1 = listOf(pt(0.07f, 0.90f), pt(0.30f, 0.76f), pt(0.16f, 0.54f), pt(0.46f, 0.47f))
        val c2 = listOf(pt(0.46f, 0.47f), pt(0.78f, 0.39f), pt(0.56f, 0.20f), pt(0.90f, 0.11f))

        fun cubic(p: List<Offset>, t: Float): Offset {
            val u = 1f - t
            val a = u * u * u
            val b = 3f * u * u * t
            val c = 3f * u * t * t
            val d = t * t * t
            return Offset(
                a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
                a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y
            )
        }
        val samples = buildList {
            repeat(48) { i -> add(cubic(c1, i / 48f)) }
            repeat(48) { i -> add(cubic(c2, i / 48f)) }
            add(cubic(c2, 1f))
        }
        val cum = FloatArray(samples.size)
        var totalLength = 0f
        for (i in 1 until samples.size) {
            totalLength += (samples[i] - samples[i - 1]).getDistance()
            cum[i] = totalLength
        }
        val length = totalLength.coerceAtLeast(1f)
        fun pointAtFraction(f: Float): Offset {
            val target = f.coerceIn(0f, 1f) * length
            var i = 1
            while (i < cum.size && cum[i] < target) i++
            if (i >= cum.size) return samples.last()
            val segStart = cum[i - 1]
            val segLen = (cum[i] - segStart).coerceAtLeast(0.0001f)
            val t = ((target - segStart) / segLen).coerceIn(0f, 1f)
            return Offset(
                samples[i - 1].x + (samples[i].x - samples[i - 1].x) * t,
                samples[i - 1].y + (samples[i].y - samples[i - 1].y) * t
            )
        }

        val road = Path().apply {
            moveTo(c1[0].x, c1[0].y)
            cubicTo(c1[1].x, c1[1].y, c1[2].x, c1[2].y, c1[3].x, c1[3].y)
            cubicTo(c2[1].x, c2[1].y, c2[2].x, c2[2].y, c2[3].x, c2[3].y)
        }
        val reveal = PathEffect.dashPathEffect(
            floatArrayOf((progress * length).coerceAtLeast(0.01f), length + 1f),
            0f
        )

        drawPath(
            path = road,
            color = Ink.copy(alpha = 0.85f),
            style = Stroke(
                width = 26.dp.toPx(),
                cap = StrokeCap.Round,
                pathEffect = reveal
            )
        )
        drawPath(
            path = road,
            color = Color(0xFFFFFDF7),
            style = Stroke(
                width = 20.dp.toPx(),
                cap = StrokeCap.Round,
                pathEffect = reveal
            )
        )
        if (active) {
            drawPath(
                path = road,
                color = Forest.copy(alpha = 0.55f),
                style = Stroke(
                    width = 2.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(
                        floatArrayOf(12.dp.toPx(), 14.dp.toPx()),
                        0f
                    )
                )
            )
        }

        // Hazard pins appear as the road draws past their position.
        val pinFractions = listOf(0.28f, 0.55f, 0.82f)
        val pinColors = listOf(PinCrimson, PinViolet, PinEmerald)
        pinFractions.forEachIndexed { index, fraction ->
            val alpha = ((progress - fraction) / 0.08f).coerceIn(0f, 1f)
            if (alpha > 0f) {
                val center = pointAtFraction(fraction)
                val outer = 11.dp.toPx() * (0.6f + 0.4f * alpha)
                drawCircle(
                    color = Color.White.copy(alpha = alpha),
                    radius = outer,
                    center = center
                )
                drawCircle(
                    color = pinColors[index].copy(alpha = alpha),
                    radius = outer * 0.62f,
                    center = center
                )
                drawCircle(
                    color = pinColors[index].copy(alpha = alpha * 0.35f),
                    radius = outer * (1f + 0.9f * pulseT),
                    center = center,
                    style = Stroke(width = 3.dp.toPx() * (1f - pulseT))
                )
            }
        }

        // The golden-hour house at the end of the road.
        run {
            val housePos = pointAtFraction(0.96f)
            val hx = housePos.x
            val hy = housePos.y
            val houseW = 34.dp.toPx()
            val houseH = 24.dp.toPx()
            val glow = variant == 2
            if (glow) {
                drawCircle(
                    color = Amber.copy(alpha = 0.18f + 0.14f * pulseT),
                    radius = houseW * (1.4f + 0.35f * pulseT),
                    center = Offset(hx, hy)
                )
            }
            // roof
            val roof = Path().apply {
                moveTo(hx - houseW * 0.62f, hy - houseH * 0.2f)
                lineTo(hx, hy - houseH * 1.05f)
                lineTo(hx + houseW * 0.62f, hy - houseH * 0.2f)
                close()
            }
            drawPath(roof, color = Color(0xFFB45309))
            // body
            drawRoundRect(
                color = Forest,
                topLeft = Offset(hx - houseW * 0.45f, hy - houseH * 0.25f),
                size = Size(houseW * 0.9f, houseH * 0.95f),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())
            )
            // window
            drawRoundRect(
                color = Amber,
                topLeft = Offset(hx - 5.dp.toPx(), hy - houseH * 0.02f),
                size = Size(10.dp.toPx(), 10.dp.toPx()),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.dp.toPx())
            )
        }
    }
}

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
    val scrollStates = List(steps.size) { rememberScrollState() }
    val page = pagerState.currentPage.coerceIn(0, steps.lastIndex)

    HodosTheme {
        Surface(Modifier.fillMaxSize(), color = Paper) {
            Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                Column(Modifier.fillMaxSize().padding(bottom = 118.dp)) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Image(
                            painter = painterResource(R.drawable.hodos_brand_icon),
                            contentDescription = "Hodos",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(11.dp))
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "hodos",
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-1.0).sp,
                            color = Ink
                        )
                        Spacer(Modifier.weight(1f))
                        if (page < steps.lastIndex) {
                            TextButton(onClick = {
                                scope.launch { pagerState.animateScrollToPage(steps.lastIndex) }
                            }) {
                                Text("Skip to setup", color = Muted, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    HorizontalPager(
                        state = pagerState,
                        modifier = Modifier.weight(1f)
                    ) { pageIndex ->
                        // Continuous position of the pager: how far this page sits
                        // from the viewport center, in page units.
                        val offset = pageIndex - (pagerState.currentPage + pagerState.currentPageOffsetFraction)
                        val step = steps[pageIndex]
                        Column(
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = offset * 48.dp.toPx()
                                    alpha = 1f - (abs(offset).coerceIn(0f, 1f) * 0.5f)
                                }
                                .verticalScroll(scrollStates[pageIndex])
                                .padding(horizontal = 24.dp)
                        ) {
                            Text(
                                step.eyebrow,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.3.sp,
                                color = Forest
                            )
                            Spacer(Modifier.height(10.dp))
                            Text(
                                step.title,
                                fontSize = 30.sp,
                                lineHeight = 35.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = (-0.9).sp,
                                color = Ink
                            )
                            Spacer(Modifier.height(12.dp))
                            Text(
                                step.description,
                                fontSize = 15.sp,
                                lineHeight = 22.sp,
                                color = Muted
                            )

                            Spacer(Modifier.height(22.dp))

                            RoadMotif(
                                variant = pageIndex,
                                active = abs(offset) < 0.5f,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(196.dp)
                                    .graphicsLayer { translationX = -offset * 90.dp.toPx() }
                            )

                            Spacer(Modifier.height(22.dp))

                            Surface(
                                shape = RoundedCornerShape(18.dp),
                                color = Color.White,
                                shadowElevation = 2.dp,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    Modifier.fillMaxWidth().padding(18.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Surface(
                                        color = Mist,
                                        shape = RoundedCornerShape(14.dp)
                                    ) {
                                        Icon(
                                            imageVector = step.icon,
                                            contentDescription = null,
                                            tint = Forest,
                                            modifier = Modifier.padding(11.dp).size(24.dp)
                                        )
                                    }
                                    Spacer(Modifier.width(14.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            step.highlightTitle,
                                            fontSize = 15.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Ink
                                        )
                                        Spacer(Modifier.height(3.dp))
                                        Text(
                                            step.highlightSub,
                                            fontSize = 13.sp,
                                            color = Muted,
                                            lineHeight = 18.sp
                                        )
                                    }
                                }
                            }

                            if (pageIndex == steps.lastIndex) {
                                Spacer(Modifier.height(16.dp))
                                Surface(
                                    shape = RoundedCornerShape(18.dp),
                                    color = Color.White,
                                    shadowElevation = 2.dp,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(
                                        Modifier.fillMaxWidth().padding(16.dp),
                                        verticalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Text(
                                            "Setup checklist",
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Ink
                                        )
                                        PermissionRow(
                                            step = 1,
                                            label = "Location & motion",
                                            hint = "Detects road impacts while you ride",
                                            granted = locationGranted,
                                            icon = Icons.Outlined.MyLocation,
                                            onClick = onRequestLocation
                                        )
                                        PermissionRow(
                                            step = 2,
                                            label = "Allow all the time",
                                            hint = "Keeps mapping while Hodos is backgrounded",
                                            granted = backgroundLocationGranted,
                                            icon = Icons.Outlined.Explore,
                                            onClick = onRequestBackgroundLocation
                                        )
                                        PermissionRow(
                                            step = 3,
                                            label = "Unrestricted battery",
                                            hint = "Stops Android from killing the service",
                                            granted = batteryUnrestricted,
                                            icon = Icons.Outlined.BatteryChargingFull,
                                            onClick = onRequestBatteryOptimization
                                        )
                                    }
                                }
                                Spacer(Modifier.height(8.dp))
                            }
                        }
                    }
                }

                Column(
                    Modifier.align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(Paper)
                        .padding(horizontal = 24.dp, vertical = 14.dp)
                ) {
                    Button(
                        onClick = {
                            if (page == steps.lastIndex) onFinishAndEnableAutoMapping()
                            else scope.launch { pagerState.animateScrollToPage(page + 1) }
                        },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Forest)
                    ) {
                        Text(
                            if (page == steps.lastIndex) "Enable Automatic Mapping & Open Map"
                            else "Continue",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(12.dp))
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
                                        if (active) Forest else Forest.copy(alpha = 0.16f),
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
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (granted) Mist else Color.White,
        border = BorderStroke(
            1.dp,
            if (granted) Forest.copy(alpha = 0.30f) else Ink.copy(alpha = 0.10f)
        ),
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clickable(enabled = !granted, onClick = onClick)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (granted) Icons.Outlined.CheckCircle else icon,
                contentDescription = null,
                tint = if (granted) Forest else AmberDeep,
                modifier = Modifier.size(20.dp)
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "$step · $label",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (granted) Forest else Ink
                )
                Text(
                    if (granted) "Allowed" else hint,
                    fontSize = 12.sp,
                    color = Muted
                )
            }
        }
    }
}

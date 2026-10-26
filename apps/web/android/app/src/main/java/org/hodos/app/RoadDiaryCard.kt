package org.hodos.app

import android.animation.ValueAnimator
import android.os.Build
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

private val DiaryForest = Color(0xFF145B46)
private val DiaryInk = Color(0xFF18372D)
private val DiaryMuted = Color(0xFF526F61)
private val DiaryMint = Color(0xFFDDF4E2)

/**
 * Small private comeback ritual: revisit the map, see which days had journeys,
 * and invite friends without uploading history or exposing precise location.
 * We deliberately award no points for miles, impacts, or driving frequency.
 */
@Composable
internal fun RoadDiaryCard(
    trips: List<RoadTrip>,
    onOpenMapping: () -> Unit,
    onShare: () -> Unit
) {
    val summary = remember(trips) {
        summarizeRoadDiary(trips, System.currentTimeMillis())
    }
    Surface(
        shape = RoundedCornerShape(27.dp),
        color = Color(0xFFE7F5E9),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            RoadDoodle(
                Modifier.fillMaxWidth().height(166.dp)
            )
            Column(
                Modifier.padding(start = 19.dp, end = 19.dp, bottom = 19.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    DoodleIcon(DoodleSymbol.DIARY, modifier = Modifier.size(29.dp), tint = DiaryForest)
                    Spacer(Modifier.width(9.dp))
                    Text("YOUR ROAD DIARY", color = DiaryForest,
                        fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                }
                Text(
                    if (summary.journeysThisWeek == 0) "Your week on the map."
                    else if (summary.activeDaysThisWeek == 1) "One recorded day this week."
                    else "${summary.activeDaysThisWeek} days with journeys.",
                    fontSize = 24.sp, fontWeight = FontWeight.Bold, color = DiaryInk
                )
                Text(
                    if (summary.journeysThisWeek == 0)
                        "Your recorded journeys will make a little trail here. Start when you're ready."
                    else "${summary.journeysThisWeek} recorded ${if (summary.journeysThisWeek == 1) "journey" else "journeys"} this week · " +
                        String.format(Locale.US, "%.1f km", summary.distanceMetersThisWeek / 1000.0) +
                        " traveled. Your summaries stay on this phone.",
                    color = DiaryMuted, fontSize = 13.sp, lineHeight = 19.sp
                )
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    listOf("M", "T", "W", "T", "F", "S", "S").forEachIndexed { index, label ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                Modifier.size(30.dp)
                                    .background(
                                        if (summary.activeDays[index]) DiaryForest
                                        else Color.White.copy(alpha = 0.8f),
                                        CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    if (summary.activeDays[index]) "✓" else "·",
                                    color = if (summary.activeDays[index]) Color.White else DiaryMuted,
                                    fontWeight = FontWeight.Bold, fontSize = 15.sp
                                )
                            }
                            Spacer(Modifier.height(3.dp))
                            Text(label, color = DiaryMuted, fontSize = 10.sp)
                        }
                    }
                }
                Text("Only completed journeys count. No streak pressure, no location trail.",
                    color = DiaryMuted, fontSize = 11.sp, lineHeight = 16.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onOpenMapping,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = DiaryForest),
                        shape = RoundedCornerShape(14.dp)
                    ) { Text("View journeys", fontSize = 12.sp) }
                    OutlinedButton(
                        onClick = onShare,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(14.dp)
                    ) { Text("Invite a friend", color = DiaryForest, fontSize = 12.sp) }
                }
            }
        }
    }
}

/**
 * Original Hodos artwork, drawn entirely with Compose Canvas vectors.
 * Deliberately unlike Google's copyrighted doodle artwork: playful, tiny
 * motion, no downloaded animation assets, tracking, or extra dependencies.
 */
@Composable
internal fun RoadDoodle(modifier: Modifier = Modifier, variant: Int = 0) {
    val context = LocalContext.current
    val motionAllowed = remember(context) {
        Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()
    }
    val transition = rememberInfiniteTransition(label = "route signal")
    val pulse by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2100, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "map location pulse"
    )
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val unit = h / 10f
        drawRect(Color(0xFFE8EEE7))
        for (i in 0..19) {
            val x = i * unit
            if (x <= w) drawLine(Color(0xFFD7E1D7), Offset(x, 0f),
                Offset(x, h), strokeWidth = 1f)
        }
        for (i in 0..12) {
            val y = i * unit
            if (y <= h) drawLine(Color(0xFFD7E1D7), Offset(0f, y),
                Offset(w, y), strokeWidth = 1f)
        }
        val road = Path().apply {
            moveTo(-w * .11f, h * .82f)
            cubicTo(w * .25f, h * .61f, w * .21f, h * .14f, w * .53f, h * .23f)
            cubicTo(w * .77f, h * .33f, w * .76f, h * .77f, w * 1.07f, h * .48f)
        }
        drawPath(road, Color(0xFFBBCFBF),
            style = Stroke(width = h * .21f, cap = StrokeCap.Round))
        drawPath(road, Color(0xFFFCFBF4),
            style = Stroke(width = h * .17f, cap = StrokeCap.Round))
        drawPath(road, Color(0xFF50856C),
            style = Stroke(
                width = h * .017f,
                cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(
                    floatArrayOf(h * .044f, h * .046f)
                )
            ))
        val point = when (variant) {
            1 -> Offset(w * .53f, h * .23f)
            2 -> Offset(w * .24f, h * .52f)
            else -> Offset(w * .71f, h * .58f)
        }
        val highlight = if (variant == 2) Color(0xFF367A62) else Color(0xFFD48D5C)
        drawCircle(Color.White, radius = h * .107f, center = point)
        drawCircle(highlight, radius = h * .077f, center = point)
        drawCircle(Color.White, radius = h * .027f, center = point)
        if (motionAllowed && variant == 1) {
            drawCircle(
                color = highlight.copy(alpha = (1f - pulse) * .6f),
                radius = h * (.08f + pulse * .15f),
                center = point,
                style = Stroke(width = h * .011f)
            )
        }
        // A small evidence node, not a decorative landscape character.
        val node = Offset(w * .15f, h * .26f)
        drawCircle(Color(0xFF316F59), radius = h * .032f, center = node)
        drawCircle(Color(0xFFE0A170), radius = h * .018f,
            center = Offset(w * .84f, h * .21f))
    }
}

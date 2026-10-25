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
                Text("YOUR LITTLE ROAD DIARY", color = DiaryForest,
                    fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Text(
                    if (summary.journeysThisWeek == 0) "A fresh week of roads."
                    else if (summary.activeDaysThisWeek == 1) "One day out exploring!"
                    else "${summary.activeDaysThisWeek} days out exploring!",
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
internal fun RoadDoodle(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val motionAllowed = remember(context) {
        Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()
    }
    val transition = rememberInfiniteTransition(label = "road companion")
    val drift by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "gentle road motion"
    )
    val movement = if (motionAllowed) drift else 0.5f
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        // Sunny sky and oversized friendly trees.
        drawCircle(Color(0xFFFFD57B), radius = h * .15f,
            center = Offset(w * .81f, h * .26f))
        drawCircle(Color(0xFFFFFFFF), radius = h * .085f,
            center = Offset(w * .22f + movement * 6f, h * .27f))
        drawCircle(Color(0xFFFFFFFF), radius = h * .065f,
            center = Offset(w * .28f + movement * 6f, h * .25f))
        val trees = listOf(.12f to .54f, .88f to .70f, .94f to .40f)
        trees.forEach { (x, y) ->
            drawLine(Color(0xFF6D8B62), Offset(w*x, h*y),
                Offset(w*x, h*(y + .17f)), strokeWidth = h*.025f,
                cap = StrokeCap.Round)
            drawCircle(Color(0xFF64AF7E), radius = h*.13f,
                center = Offset(w*x, h*y))
            drawCircle(Color(0xFF8FD09A), radius = h*.075f,
                center = Offset(w*x - h*.04f, h*y - h*.035f))
        }
        val road = Path().apply {
            moveTo(-24f, h*.95f)
            cubicTo(w*.10f, h*.55f, w*.32f, h*.96f, w*.52f, h*.66f)
            cubicTo(w*.70f, h*.41f, w*.83f, h*.83f, w+24f, h*.54f)
        }
        drawPath(road, Color(0xFFB7CCB8),
            style = Stroke(width = h*.22f, cap = StrokeCap.Round))
        drawPath(road, Color(0xFFF8FFF6),
            style = Stroke(
                width = h*.018f,
                cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(h*.08f, h*.08f))
            ))
        // Cheerful illustrated mini-car, moving only a few pixels.
        val cx = w*.52f + (movement-.5f)*12f
        val cy = h*.60f - movement * 4f
        drawRoundRect(Color(0xFF257B65), topLeft = Offset(cx-h*.19f, cy),
            size = Size(h*.38f, h*.16f), cornerRadius = CornerRadius(h*.045f))
        drawRoundRect(Color(0xFF3C9477), topLeft = Offset(cx-h*.11f, cy-h*.078f),
            size = Size(h*.22f, h*.12f), cornerRadius = CornerRadius(h*.043f))
        drawRoundRect(Color(0xFFCDEFE8), topLeft = Offset(cx-h*.065f, cy-h*.053f),
            size = Size(h*.13f, h*.066f), cornerRadius = CornerRadius(h*.018f))
        drawCircle(Color(0xFF273E38), radius = h*.033f,
            center = Offset(cx-h*.117f, cy+h*.15f))
        drawCircle(Color(0xFF273E38), radius = h*.033f,
            center = Offset(cx+h*.117f, cy+h*.15f))
        drawCircle(Color.White, radius = h*.014f,
            center = Offset(cx-h*.055f, cy+h*.08f))
        drawCircle(Color.White, radius = h*.014f,
            center = Offset(cx+h*.055f, cy+h*.08f))
        drawLine(Color(0xFFF5D8A3), Offset(cx-h*.025f, cy+h*.117f),
            Offset(cx+h*.025f, cy+h*.117f), strokeWidth = h*.012f,
            cap = StrokeCap.Round)
    }
}

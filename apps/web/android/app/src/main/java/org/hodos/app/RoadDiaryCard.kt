package org.hodos.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

/**
 * Weekly road summary in the survey-sheet language: hairline-bordered panel,
 * mono data labels, and the week strip as filled/empty day markers.
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
        shape = RoundedCornerShape(20.dp),
        color = PaperRaised,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(8.dp).background(Amber, RoundedCornerShape(2.dp))
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "WEEKLY ROAD ACTIVITY",
                    color = Muted,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = OverpassMono,
                    letterSpacing = 1.2.sp
                )
            }
            Text(
                if (summary.journeysThisWeek == 0) "Ready for your week on the road."
                else if (summary.activeDaysThisWeek == 1) "1 active mapping day this week."
                else "${summary.activeDaysThisWeek} active mapping days this week.",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-0.4).sp,
                color = Ink,
                lineHeight = 27.sp
            )
            Text(
                if (summary.journeysThisWeek == 0)
                    "Keep Automatic Mapping enabled while you drive, ride, or commute."
                else "${summary.journeysThisWeek} ${if (summary.journeysThisWeek == 1) "journey" else "journeys"} · " +
                    String.format(Locale.US, "%.1f km", summary.distanceMetersThisWeek / 1000.0) +
                    " mapped this week.",
                color = Muted,
                fontSize = 13.5.sp,
                lineHeight = 19.sp
            )
            Surface(
                color = Sand,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    listOf("M", "T", "W", "T", "F", "S", "S").forEachIndexed { index, label ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                Modifier.size(30.dp)
                                    .background(
                                        if (summary.activeDays[index]) Ink
                                        else PaperRaised,
                                        CircleShape
                                    )
                                    .border(
                                        1.dp,
                                        if (summary.activeDays[index]) Ink else Line,
                                        CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Box(
                                    Modifier.size(6.dp).background(
                                        if (summary.activeDays[index]) Amber else Line,
                                        CircleShape
                                    )
                                )
                            }
                            Spacer(Modifier.height(5.dp))
                            Text(
                                label,
                                color = Muted,
                                fontSize = 9.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = OverpassMono
                            )
                        }
                    }
                }
            }
            Button(
                onClick = onOpenMapping,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("Mapping status", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

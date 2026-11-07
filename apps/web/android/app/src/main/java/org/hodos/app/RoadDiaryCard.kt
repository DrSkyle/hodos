package org.hodos.app

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
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
 * Clean, Apple-minimal weekly road summary card with zero schematic illustration
 * and direct APK file sharing via Quick Share / Bluetooth.
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
        shape = RoundedCornerShape(24.dp),
        color = Color.White,
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            Modifier.padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(color = Color(0xFFEAF3ED), shape = RoundedCornerShape(10.dp)) {
                    DoodleIcon(
                        DoodleSymbol.DIARY,
                        modifier = Modifier.padding(8.dp).size(20.dp),
                        tint = Forest
                    )
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    "WEEKLY ROAD ACTIVITY",
                    color = Forest,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp
                )
            }
            Text(
                if (summary.journeysThisWeek == 0) "Ready for your week on the road."
                else if (summary.activeDaysThisWeek == 1) "1 active mapping day this week."
                else "${summary.activeDaysThisWeek} active mapping days this week.",
                fontSize = 23.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = Ink
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
                color = Color(0xFFF4F8F5),
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
                                Modifier.size(32.dp)
                                    .background(
                                        if (summary.activeDays[index]) Forest
                                        else Color.White,
                                        CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    if (summary.activeDays[index]) "✓" else "·",
                                    color = if (summary.activeDays[index]) Color.White else Muted,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp
                                )
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(label, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onOpenMapping,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Forest),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Text("Mapping status", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                }
                OutlinedButton(
                    onClick = onShare,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Icon(Icons.Outlined.Share, contentDescription = null, modifier = Modifier.size(16.dp), tint = Forest)
                    Spacer(Modifier.width(6.dp))
                    Text("Send APK", color = Ink, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

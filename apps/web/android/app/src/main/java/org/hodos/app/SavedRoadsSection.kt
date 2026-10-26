package org.hodos.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val DeepGreen = Color(0xFF155C49)
private val QuietGreen = Color(0xFF678074)
private val DeepInk = Color(0xFF1A352B)

/**
 * The public map is refreshed on activity resume; returning to My Roads reveals
 * changed server-confirmed repair state without watching a person's movements.
 */
@Composable
internal fun SavedRoadsSection(
    savedIds: Set<String>,
    hazards: List<RoadHazard>,
    onSelect: (RoadHazard) -> Unit,
    onRemove: (String) -> Unit
) {
    val byId = hazards.associateBy { it.id }
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                DoodleIcon(DoodleSymbol.BOOKMARK, modifier = Modifier.size(30.dp), tint = DeepGreen)
                Spacer(Modifier.width(9.dp))
                Text("My Roads", color = DeepInk, fontSize = 21.sp,
                    fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text("${savedIds.size}/100", fontSize = 12.sp, color = QuietGreen)
            }
            Text(
                if (savedIds.isEmpty())
                    "Found a road you care about? Open its map report and tap Save this road. Come back to see its latest verified status."
                else "Saved here on your phone. Reopen Hodos to check for new community reports.",
                fontSize = 13.sp, color = QuietGreen, lineHeight = 20.sp
            )
            savedIds.toList().sorted().take(8).forEachIndexed { index, id ->
                if (index > 0) HorizontalDivider(color = Color(0xFFEAF0EB))
                val hazard = byId[id]
                Row(verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (hazard == null) {
                        DoodleIcon(DoodleSymbol.WARNING,
                            tint = QuietGreen, modifier = Modifier.size(27.dp))
                    } else if (hazard.fixed) {
                        DoodleIcon(DoodleSymbol.CHECK,
                            tint = DeepGreen, modifier = Modifier.size(27.dp))
                    } else {
                        DoodleIcon(DoodleSymbol.WARNING,
                            tint = Color(0xFFC18A45), modifier = Modifier.size(27.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(
                        modifier = Modifier.weight(1f)
                            .then(
                                if (hazard == null) Modifier
                                else Modifier.clickable { onSelect(hazard) }
                            )
                            .padding(vertical = 7.dp)
                    ) {
                        Text(hazard?.title ?: "Unavailable in current map",
                            fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                            color = DeepInk)
                        Text(
                            if (hazard == null) "Refresh the map to check this report"
                            else if (hazard.fixed) "Reported repaired · open for details"
                            else "${hazard.severityText} severity · open for details",
                            fontSize = 12.sp, color = QuietGreen
                        )
                    }
                    TextButton(onClick = {
                        if (hazard == null) onRemove(id) else onSelect(hazard)
                    }) {
                        Text(if (hazard == null) "Remove" else "View",
                            color = DeepGreen, fontSize = 12.sp)
                    }
                }
            }
            if (savedIds.size > 8) {
                Text("Showing 8 of ${savedIds.size} saved roads.",
                    color = QuietGreen, fontSize = 12.sp)
            }
        }
    }
}

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
        color = PaperRaised,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Line),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                DoodleIcon(DoodleSymbol.BOOKMARK, modifier = Modifier.size(26.dp), tint = Ink)
                Spacer(Modifier.width(9.dp))
                Text("My Roads", color = Ink, fontSize = 19.sp,
                    fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.3).sp, modifier = Modifier.weight(1f))
                Text("${savedIds.size}/100", fontSize = 10.5.sp, color = Muted,
                    fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp)
            }
            Text(
                if (savedIds.isEmpty())
                    "Found a road you care about? Open its map report and tap Save this road. Come back to see its latest verified status."
                else "Saved here on your phone. Reopen Hodos to check for new community reports.",
                fontSize = 13.sp, color = Muted, lineHeight = 20.sp
            )
            savedIds.toList().sorted().take(8).forEachIndexed { index, id ->
                if (index > 0) HorizontalDivider(color = Line)
                val hazard = byId[id]
                Row(verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (hazard == null) {
                        DoodleIcon(DoodleSymbol.WARNING,
                            tint = Muted, modifier = Modifier.size(24.dp))
                    } else if (hazard.fixed) {
                        DoodleIcon(DoodleSymbol.CHECK,
                            tint = Healed, modifier = Modifier.size(24.dp))
                    } else {
                        DoodleIcon(DoodleSymbol.WARNING,
                            tint = AmberDeep, modifier = Modifier.size(24.dp))
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
                            color = Ink)
                        Text(
                            if (hazard == null) "Refresh the map to check this report"
                            else if (hazard.fixed) "Reported repaired · open for details"
                            else "${hazard.severityText} severity · open for details",
                            fontSize = 12.sp, color = Muted
                        )
                    }
                    TextButton(onClick = {
                        if (hazard == null) onRemove(id) else onSelect(hazard)
                    }) {
                        Text(if (hazard == null) "Remove" else "View",
                            color = Ink, fontSize = 12.sp)
                    }
                }
            }
            if (savedIds.size > 8) {
                Text("Showing 8 of ${savedIds.size} saved roads.",
                    color = Muted, fontSize = 12.sp)
            }
        }
    }
}

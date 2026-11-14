package org.hodos.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

/**
 * Roads: what the surface under you is actually made of, how each corridor
 * scores, and how much roughness it puts into your vehicle.
 */
@Composable
internal fun RoadsScreen(
    trails: List<TripTrail>,
    travelProfile: String,
    onBack: () -> Unit
) {
    val cells = remember(trails) { RoadQuality.cellsFromTrails(trails) }
    val surfaces = remember(cells) { RoadQuality.surfaceShare(cells) }
    val wear = remember(cells, travelProfile) { RoadQuality.wearEstimate(cells, travelProfile) }
    val smoothScore = remember(cells) { RoadQuality.smoothRouteScore(cells) }
    val smoothNote = remember(cells) { RoadQuality.smoothRouteSummary(cells) }
    val worst = remember(cells) { cells.sortedBy { it.quality }.take(6) }

    LazyColumn(
        Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        item {
            HodosSubHeader("Roads", "Surface, quality and wear", onBack)
        }

        if (cells.isEmpty()) {
            item {
                EmptyPanel(
                    "No corridor data yet",
                    "Roads fills in as you drive. Each pass measures vibration energy so surface type and quality build up over time."
                )
            }
            return@LazyColumn
        }

        // SURFACE MIX
        item {
            SectionLabel("SURFACE UNDER YOU")
            Spacer(Modifier.height(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                surfaces.forEach { share ->
                    SurfaceShareRow(share)
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                "Inferred from sustained vibration energy, not imagery. A surface is only named once at least two passes agree.",
                color = Muted, fontSize = 11.5.sp, lineHeight = 17.sp
            )
        }

        // CORRIDOR QUALITY
        item {
            SectionLabel("CORRIDOR QUALITY")
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile("${cells.size}", "Stretches", Modifier.weight(1f))
                StatTile("${cells.count { it.quality >= 62 }}", "Fair or better", Modifier.weight(1f))
                StatTile(smoothScore?.toString() ?: "—", "Smooth ceiling", Modifier.weight(1f))
            }
            smoothNote?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = Muted, fontSize = 12.5.sp, lineHeight = 18.sp)
            }
        }

        // ROUGHEST STRETCHES
        if (worst.isNotEmpty()) {
            item {
                SectionLabel("ROUGHEST STRETCHES")
                Spacer(Modifier.height(6.dp))
                Column {
                    worst.forEachIndexed { index, cell ->
                        if (index > 0) HorizontalDivider(color = Line)
                        QualityRow(cell)
                    }
                }
            }
        }

        // WEAR
        item {
            SectionLabel("VEHICLE WEAR")
            Spacer(Modifier.height(12.dp))
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = PaperRaised
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${wear.loadIndex}/1000",
                            fontSize = 30.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = (-0.6).sp
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            wear.vehicleLabel.uppercase(),
                            color = AmberDeep,
                            fontSize = 10.sp,
                            fontFamily = OverpassMono,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 1.sp
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        String.format(
                            Locale.US,
                            "Accumulated over %.1f km of recorded road.",
                            wear.distanceKm
                        ),
                        color = Muted, fontSize = 12.5.sp
                    )
                    Spacer(Modifier.height(14.dp))
                    HorizontalDivider(color = Line)
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Estimated suspension & tyre cost",
                        fontWeight = FontWeight.Bold, fontSize = 13.5.sp
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${wear.repairCostLow}–${wear.repairCostHigh} in local-currency units",
                        color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "An illustrative estimate from roughness × distance, not a quote. It grows as you record more road.",
                        color = Muted, fontSize = 11.5.sp, lineHeight = 17.sp
                    )
                }
            }
        }

        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
private fun SurfaceShareRow(share: SurfaceShare) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            RoadQuality.surfaceLabel(share.kind),
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.width(92.dp)
        )
        Box(
            Modifier
                .weight(1f)
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Sand)
        ) {
            Box(
                Modifier
                    .fillMaxWidth(share.share.coerceIn(0f, 1f))
                    .height(8.dp)
                    .background(surfaceColor(share.kind), RoundedCornerShape(4.dp))
            )
        }
        Spacer(Modifier.width(12.dp))
        Text(
            "${(share.share * 100).toInt()}%",
            color = Muted,
            fontSize = 10.5.sp,
            fontFamily = OverpassMono,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.width(38.dp)
        )
    }
}

@Composable
private fun QualityRow(cell: RoadCell) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(10.dp)
                .background(qualityColor(cell.quality), RoundedCornerShape(2.dp))
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                String.format(Locale.US, "%.3f, %.3f", cell.lat, cell.lng),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink
            )
            Text(
                "${cell.surface.label.uppercase()} · ${cell.passes} PASSES · ${cell.impacts} IMPACTS",
                color = Muted, fontSize = 9.5.sp,
                fontFamily = OverpassMono,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.6.sp
            )
        }
        Text(
            "${cell.quality}",
            fontSize = 16.sp,
            fontWeight = FontWeight.ExtraBold,
            color = qualityColor(cell.quality)
        )
        Spacer(Modifier.width(4.dp))
        Text(cell.grade, color = Muted, fontSize = 10.5.sp)
    }
}

@Composable
internal fun SectionLabel(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(Amber, RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            color = Muted,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = OverpassMono,
            letterSpacing = 1.2.sp
        )
    }
}

@Composable
internal fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp))
            .background(Sand)
            .border(1.dp, Line, RoundedCornerShape(16.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(value, fontWeight = FontWeight.ExtraBold, fontSize = 21.sp, color = Ink)
        Text(
            label.uppercase(),
            color = Muted,
            fontSize = 9.sp,
            fontFamily = OverpassMono,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.8.sp
        )
    }
}

@Composable
internal fun EmptyPanel(title: String, body: String) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = PaperRaised,
        border = BorderStroke(1.dp, Line)
    ) {
        Column(Modifier.fillMaxWidth().padding(22.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Spacer(Modifier.height(6.dp))
            Text(body, color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
        }
    }
}

@Composable
internal fun HodosSubHeader(title: String, subtitle: String, onBack: () -> Unit) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = PaperRaised,
                border = BorderStroke(1.dp, Line),
                onClick = onBack
            ) {
                Text(
                    "← BACK",
                    color = Ink,
                    fontSize = 9.5.sp,
                    fontFamily = OverpassMono,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(title, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp)
        Spacer(Modifier.height(4.dp))
        Text(subtitle, color = Muted, fontSize = 14.sp)
        Spacer(Modifier.height(4.dp))
    }
}

private fun surfaceColor(kind: SurfaceKind): Color = when (kind) {
    SurfaceKind.ASPHALT -> Ink
    SurfaceKind.GRAVEL -> Amber
    SurfaceKind.COBBLE -> Bump
    SurfaceKind.UNKNOWN -> Line
}

internal fun qualityColor(quality: Int): Color = when {
    quality >= 80 -> Healed
    quality >= 55 -> Rough
    else -> Pothole
}

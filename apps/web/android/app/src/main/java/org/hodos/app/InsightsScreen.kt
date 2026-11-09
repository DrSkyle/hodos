package org.hodos.app

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

/**
 * Insights: which hazards are getting worse, where a repair budget would land
 * hardest, and what a smooth route could promise on the corridors you drive.
 */
@Composable
internal fun InsightsScreen(
    trails: List<TripTrail>,
    hazards: List<RoadHazard>,
    onBack: () -> Unit
) {
    val cells = remember(trails) { RoadQuality.cellsFromTrails(trails) }
    val watch = remember(hazards) { RoadQuality.deteriorationWatch(hazards) }
    val clusters = remember(hazards) { RoadQuality.repairClusters(hazards) }
    val smoothScore = remember(cells) { RoadQuality.smoothRouteScore(cells) }
    val smoothNote = remember(cells) { RoadQuality.smoothRouteSummary(cells) }

    LazyColumn(
        Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        item {
            HodosSubHeader("Insights", "Deterioration, repair value, smooth routes", onBack)
        }

        // DETERIORATION
        item {
            SectionLabel("WORSENING WATCHLIST")
            Spacer(Modifier.height(12.dp))
            if (watch.isEmpty()) {
                EmptyPanel(
                    "Nothing on the watchlist",
                    "Hazards appear here ranked by severity, confirmations and how long they have been un-repaired."
                )
            } else {
                Column {
                    watch.forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider(color = Line)
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                Modifier
                                    .size(10.dp)
                                    .background(qualityColor(100 - row.riskIndex), RoundedCornerShape(2.dp))
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(row.hazard.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                Text(
                                    "${row.hazard.severityText.uppercase()} · ${row.hazard.passes} PASSES · ${row.ageDays}D UNFIXED",
                                    color = Muted, fontSize = 9.5.sp,
                                    fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp
                                )
                            }
                            Text("${row.riskIndex}", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
                            Spacer(Modifier.width(3.dp))
                            Text("risk", color = Muted, fontSize = 10.sp)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Risk combines severity, confirmation count and age since first observation. It is a prioritisation aid, not an engineering survey.",
                    color = Muted, fontSize = 11.5.sp, lineHeight = 17.sp
                )
            }
        }

        // REPAIR ROI
        item {
            SectionLabel("REPAIR VALUE")
            Spacer(Modifier.height(12.dp))
            if (clusters.isEmpty()) {
                EmptyPanel(
                    "No repair clusters yet",
                    "Once hazards gather on the public map, the biggest clusters appear here ranked by how much ride stress they cover."
                )
            } else {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Ink
                ) {
                    Column(Modifier.fillMaxWidth().padding(20.dp)) {
                        Text(
                            "Top ${clusters.size} clusters",
                            color = Paper,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Fixing these addresses ${(clusters.sumOf { it.coverage.toDouble() } * 100).toInt()}% of mapped road stress.",
                            color = Paper.copy(alpha = 0.7f),
                            fontSize = 12.5.sp,
                            lineHeight = 18.sp
                        )
                        Spacer(Modifier.height(14.dp))
                        clusters.forEachIndexed { index, cluster ->
                            if (index > 0) {
                                HorizontalDivider(color = Paper.copy(alpha = 0.12f), thickness = 1.dp)
                                Spacer(Modifier.height(10.dp))
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        String.format(Locale.US, "%.3f, %.3f", cluster.lat, cluster.lng),
                                        color = Paper,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        "${cluster.hazards} HAZARDS",
                                        color = Paper.copy(alpha = 0.55f),
                                        fontSize = 9.5.sp,
                                        fontFamily = OverpassMono,
                                        fontWeight = FontWeight.SemiBold,
                                        letterSpacing = 0.8.sp
                                    )
                                }
                                Text(
                                    "${(cluster.coverage * 100).toInt()}%",
                                    color = Amber,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.ExtraBold
                                )
                            }
                            Spacer(Modifier.height(10.dp))
                        }
                    }
                }
            }
        }

        // SMOOTH ROUTE
        item {
            SectionLabel("SMOOTH ROUTE")
            Spacer(Modifier.height(12.dp))
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = PaperRaised,
                border = androidx.compose.foundation.BorderStroke(1.dp, Line)
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            smoothScore?.toString() ?: "—",
                            fontSize = 34.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = (-0.8).sp
                        )
                        Text(
                            "/100 smooth ceiling",
                            color = Muted,
                            fontSize = 11.sp,
                            fontFamily = OverpassMono,
                            modifier = Modifier.padding(start = 6.dp, bottom = 8.dp)
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        smoothNote ?: "Record more of your usual roads to compare smooth and rough stretches.",
                        color = Muted,
                        fontSize = 12.5.sp,
                        lineHeight = 18.sp
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "The best quality a routing profile could promise from your recorded roads today.",
                        color = Muted,
                        fontSize = 11.sp,
                        lineHeight = 16.sp
                    )
                }
            }
        }

        item { Spacer(Modifier.height(14.dp)) }
    }
}

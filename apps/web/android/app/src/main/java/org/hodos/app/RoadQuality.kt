package org.hodos.app

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import java.util.Locale

/**
 * Road-quality intelligence derived from the journey trails the phone already
 * records. Everything here is computed locally; nothing new leaves the device.
 */

enum class SurfaceKind(val label: String) {
    ASPHALT("Asphalt"),
    GRAVEL("Gravel"),
    COBBLE("Cobbles"),
    UNKNOWN("Unclassified")
}

/**
 * One ~150 m stretch of road. Cells are bucketed from GPS fixes with their
 * captured vibration energy, so the same road accumulates evidence across
 * every pass the phone makes.
 */
data class RoadCell(
    val key: String,
    val lat: Double,
    val lng: Double,
    val passes: Int,
    val roughness: Double,
    val meanSpeedKph: Double,
    val impacts: Int,
    val stress: Double
) {
    /** 0 = broken, 100 = glass. Derived from sustained vibration + impact stress. */
    val quality: Int
        get() {
            val roughPenalty = (roughness * 260.0).coerceIn(0.0, 60.0)
            val impactPenalty = (stress * 1.6).coerceIn(0.0, 40.0)
            return (100.0 - roughPenalty - impactPenalty).roundToInt().coerceIn(0, 100)
        }

    val grade: String
        get() = when {
            quality >= 82 -> "Smooth"
            quality >= 62 -> "Fair"
            quality >= 40 -> "Rough"
            else -> "Severe"
        }

    /**
     * Surface inference from the vibration signature. Sustained low-frequency
     * roughness with few discrete impacts reads as cobbles; many small impacts
     * with mid roughness reads as gravel; everything else is asphalt.
     */
    val surface: SurfaceKind
        get() {
            if (passes < 2) return SurfaceKind.UNKNOWN
            val impactRate = if (passes > 0) impacts.toDouble() / passes else 0.0
            return when {
                roughness < 0.055 -> SurfaceKind.ASPHALT
                roughness >= 0.10 && impactRate < 0.6 -> SurfaceKind.COBBLE
                impactRate >= 0.6 -> SurfaceKind.GRAVEL
                roughness >= 0.075 -> SurfaceKind.GRAVEL
                else -> SurfaceKind.ASPHALT
            }
        }
}

data class SurfaceShare(val kind: SurfaceKind, val meters: Double, val share: Float)

data class WearEstimate(
    val loadIndex: Int,
    val distanceKm: Double,
    val vehicleLabel: String,
    val repairCostLow: Int,
    val repairCostHigh: Int
)

data class DeteriorationRow(val hazard: RoadHazard, val riskIndex: Int, val ageDays: Int)

data class RepairCluster(
    val lat: Double,
    val lng: Double,
    val hazards: Int,
    val stress: Double,
    val coverage: Float
)

object RoadQuality {

    private const val CELL_DEG_LAT = 0.0015
    private const val CELL_DEG_LNG_BASE = 0.0015

    private fun cellKey(lat: Double, lng: Double): String {
        val latBucket = (lat / CELL_DEG_LAT).toInt()
        val scale = cos(Math.toRadians(lat)).coerceAtLeast(0.2)
        val lngBucket = (lng / (CELL_DEG_LNG_BASE / scale)).toInt()
        return "$latBucket:$lngBucket"
    }

    private fun cellCenter(key: String): Pair<Double, Double> {
        val parts = key.split(":")
        if (parts.size != 2) return 0.0 to 0.0
        val latBucket = parts[0].toIntOrNull() ?: 0
        val lngBucket = parts[1].toIntOrNull() ?: 0
        val lat = (latBucket + 0.5) * CELL_DEG_LAT
        val scale = cos(Math.toRadians(lat)).coerceAtLeast(0.2)
        val lng = (lngBucket + 0.5) * (CELL_DEG_LNG_BASE / scale)
        return lat to lng
    }

    /** Buckets every fix + impact of the given trails into cells. */
    fun cellsFromTrails(trails: List<TripTrail>): List<RoadCell> {
        if (trails.isEmpty()) return emptyList()
        class Acc {
            var fixes = 0
            var roughSum = 0.0
            var roughCount = 0
            var speedSum = 0.0
            var speedCount = 0
            var impacts = 0
            var stress = 0.0
        }

        val buckets = HashMap<String, Acc>()
        for (trail in trails) {
            for (fix in trail.fixes) {
                if (!fix.roughness.isFinite() || fix.roughness < 0) continue
                val acc = buckets.getOrPut(cellKey(fix.lat, fix.lng)) { Acc() }
                acc.fixes++
                acc.roughSum += fix.roughness
                acc.roughCount++
                if (fix.speed.isFinite() && fix.speed >= 0) {
                    acc.speedSum += fix.speed * 3.6
                    acc.speedCount++
                }
            }
            for (impact in trail.impacts) {
                val acc = buckets.getOrPut(cellKey(impact.lat, impact.lng)) { Acc() }
                acc.impacts++
                acc.stress += when (impact.severity) {
                    3 -> 5.0
                    2 -> 2.5
                    else -> 1.0
                }
            }
        }
        return buckets.map { (key, acc) ->
            val (lat, lng) = cellCenter(key)
            RoadCell(
                key = key,
                lat = lat,
                lng = lng,
                passes = acc.fixes,
                roughness = if (acc.roughCount > 0) acc.roughSum / acc.roughCount else 0.0,
                meanSpeedKph = if (acc.speedCount > 0) acc.speedSum / acc.speedCount else 0.0,
                impacts = acc.impacts,
                stress = acc.stress
            )
        }.sortedByDescending { it.stress }
    }

    /** Share of recorded distance per surface type. */
    fun surfaceShare(cells: List<RoadCell>): List<SurfaceShare> {
        val byKind = HashMap<SurfaceKind, Double>()
        var total = 0.0
        for (cell in cells) {
            if (cell.surface == SurfaceKind.UNKNOWN) continue
            val meters = cell.passes * 12.0
            byKind[cell.surface] = (byKind[cell.surface] ?: 0.0) + meters
            total += meters
        }
        if (total <= 0) return emptyList()
        return byKind.map { (kind, meters) ->
            SurfaceShare(kind, meters, (meters / total).toFloat())
        }.sortedByDescending { it.share }
    }

    private fun wearFactor(profile: String): Double = when (profile) {
        "bike" -> 0.22
        "scooter" -> 0.55
        "car" -> 1.0
        else -> 0.85
    }

    private fun vehicleLabel(profile: String): String = when (profile) {
        "bike" -> "Bicycle"
        "scooter" -> "Scooter"
        "car" -> "Car"
        else -> "Mixed fleet"
    }

    /**
     * Roughness × distance load on the vehicle. The cost window is an
     * illustrative repair-cost band, clearly labelled as an estimate.
     */
    fun wearEstimate(cells: List<RoadCell>, profile: String): WearEstimate {
        var load = 0.0
        var km = 0.0
        for (cell in cells) {
            if (cell.roughness <= 0.0) continue
            val cellKm = cell.passes * 12.0 / 1000.0
            km += cellKm
            // Sustained vibration above a smooth baseline multiplied by distance.
            val roughnessExcess = (cell.roughness - 0.02).coerceAtLeast(0.0)
            load += cellKm * roughnessExcess.pow(1.4) * 1000.0
        }
        val factor = wearFactor(profile)
        val loadIndex = (load * factor).roundToInt().coerceIn(0, 1000)
        val baseLow = 90.0
        val baseHigh = 260.0
        return WearEstimate(
            loadIndex = loadIndex,
            distanceKm = km,
            vehicleLabel = vehicleLabel(profile),
            repairCostLow = (baseLow + loadIndex * 0.9 * factor).roundToInt(),
            repairCostHigh = (baseHigh + loadIndex * 2.4 * factor).roundToInt()
        )
    }

    /**
     * Hazards most likely to worsen: severity combined with time since first
     * seen and how often it has been confirmed.
     */
    fun deteriorationWatch(hazards: List<RoadHazard>, now: Long = System.currentTimeMillis()): List<DeteriorationRow> {
        val rows = mutableListOf<DeteriorationRow>()
        for (hazard in hazards) {
            if (hazard.fixed) continue
            val firstSeen = parseIso(hazard.firstSeen) ?: continue
            val ageDays = ((now - firstSeen) / 86_400_000.0).toInt().coerceAtLeast(0)
            val risk = hazard.severity * 10 + hazard.passes * 2 + (ageDays / 7).coerceAtMost(20)
            rows.add(DeteriorationRow(hazard, risk, ageDays))
        }
        return rows.sortedByDescending { it.riskIndex }.take(6)
    }

    private fun parseIso(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return runCatching {
            java.time.Instant.parse(value).toEpochMilli()
        }.getOrNull()
    }

    /**
     * Groups nearby hazards into repair clusters and ranks by the share of
     * total road stress each cluster covers.
     */
    fun repairClusters(hazards: List<RoadHazard>, maxClusters: Int = 5): List<RepairCluster> {
        if (hazards.isEmpty()) return emptyList()
        data class Bucket(val key: String, val lat: Double, val lng: Double, var hazards: Int, var stress: Double)
        val map = HashMap<String, Bucket>()
        for (hazard in hazards) {
            if (hazard.fixed) continue
            val key = cellKey(hazard.lat, hazard.lng)
            val (lat, lng) = cellCenter(key)
            val bucket = map.getOrPut(key) { Bucket(key, lat, lng, 0, 0.0) }
            bucket.hazards++
            bucket.stress += when (hazard.severity) {
                3 -> 5.0
                2 -> 2.5
                else -> 1.0
            }
        }
        val total = map.values.sumOf { it.stress }
        if (total <= 0) return emptyList()
        return map.values
            .sortedByDescending { it.stress }
            .take(maxClusters)
            .map { RepairCluster(it.lat, it.lng, it.hazards, it.stress, (it.stress / total).toFloat()) }
    }

    /**
     * Average quality across the smoothest connected cells — the score a
     * smooth-route profile could promise on this corridor.
     */
    fun smoothRouteScore(cells: List<RoadCell>): Int? {
        if (cells.isEmpty()) return null
        val ranked = cells.sortedByDescending { it.quality }
        val take = (ranked.size * 0.25).toInt().coerceAtLeast(1)
        return ranked.take(take).map { it.quality }.average().roundToInt()
    }

    fun smoothRouteSummary(cells: List<RoadCell>): String? {
        if (cells.size < 4) return null
        val best = cells.maxByOrNull { it.quality } ?: return null
        val worst = cells.minByOrNull { it.quality } ?: return null
        val delta = worst.quality - best.quality
        if (delta <= 5) return "This corridor is uniformly ${best.grade.lowercase(Locale.US)}."
        return String.format(
            Locale.US,
            "Choosing %s stretches over %s gains %d quality points on this corridor.",
            best.grade.lowercase(Locale.US), worst.grade.lowercase(Locale.US), delta
        )
    }

    fun surfaceLabel(kind: SurfaceKind): String = kind.label
}

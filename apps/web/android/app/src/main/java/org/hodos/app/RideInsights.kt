package org.hodos.app

import java.util.Calendar
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.roundToInt

/** A GPS-derived driving event. Not a road hazard, so it never enters the hazard table. */
data class RideEvent(
    val t: Long,
    val lat: Double,
    val lng: Double,
    val kind: String,
    val magnitude: Double,
    val speedKph: Double
) {
    val label: String get() = when (kind) {
        "harsh_brake" -> "Harsh braking"
        "sharp_turn" -> "Sharp corner"
        else -> "Event"
    }
}

data class RoadScore(
    val score: Int,
    val grade: String,
    val defectsPerKm: Double,
    val worstKind: String?
)

/**
 * Turns the fixes a journey already records into personal insight:
 * road score, harsh-braking and sharp-corner events, distance-along-ride, and
 * a contribution streak. Everything here is local and coordinate-free in any
 * output that leaves the phone.
 */
object RideInsights {

    private const val MIN_BRAKE_DECEL = 3.0
    private const val MIN_BRAKE_SPEED = 6.0
    private const val MIN_BRAKE_DROP = 2.5
    private const val BRAKE_DEBOUNCE_MS = 6_000L
    private const val MIN_TURN_DEG = 35.0
    private const val MIN_TURN_SPEED = 3.0
    private const val TURN_DEBOUNCE_MS = 6_000L
    private const val MAX_GAP_MS = 6_000L

    private fun haversine(a: SavedFix, b: SavedFix): Double {
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(a.lat)) * Math.cos(Math.toRadians(b.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
        return 2 * 6_371_008.8 * Math.asin(minOf(1.0, Math.sqrt(s)))
    }

    private fun bearing(a: SavedFix, b: SavedFix): Double {
        val lat1 = Math.toRadians(a.lat)
        val lat2 = Math.toRadians(b.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val y = Math.sin(dLng) * Math.cos(lat2)
        val x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
        return Math.toDegrees(atan2(y, x))
    }

    private fun segmentSpeed(a: SavedFix, b: SavedFix): Double {
        val dt = (b.t - a.t) / 1000.0
        return if (dt > 0.2 && dt <= 10) haversine(a, b) / dt else 0.0
    }

    fun harshBraking(fixes: List<SavedFix>): List<RideEvent> = buildList {
        var lastAt = 0L
        for (i in 1 until fixes.size) {
            val previous = fixes[i - 1]
            val current = fixes[i]
            val dt = (current.t - previous.t) / 1000.0
            if (dt <= 0.3 || current.t - previous.t > MAX_GAP_MS) continue
            val moving = maxOf(previous.speed, segmentSpeed(previous, current))
            if (!moving.isFinite() || moving < MIN_BRAKE_SPEED) continue
            // A fix without a reported speed must not look like a full stop, so
            // fall back to displacement speed before judging the drop.
            val after = if (current.speed > 0.1) current.speed else segmentSpeed(previous, current)
            val decel = (moving - after) / dt
            if (decel < MIN_BRAKE_DECEL || moving - after < MIN_BRAKE_DROP) continue
            if (lastAt > 0 && current.t - lastAt < BRAKE_DEBOUNCE_MS) continue
            lastAt = current.t
            add(RideEvent(
                t = current.t,
                lat = current.lat,
                lng = current.lng,
                kind = "harsh_brake",
                magnitude = decel,
                speedKph = moving * 3.6
            ))
        }
    }

    fun sharpTurns(fixes: List<SavedFix>): List<RideEvent> = buildList {
        if (fixes.size < 3) return@buildList
        var lastAt = 0L
        for (i in 1 until fixes.size - 1) {
            val previous = fixes[i - 1]
            val current = fixes[i]
            val next = fixes[i + 1]
            if (current.t - previous.t > MAX_GAP_MS || next.t - current.t > MAX_GAP_MS) continue
            val inSpeed = segmentSpeed(previous, current)
            val outSpeed = segmentSpeed(current, next)
            if (inSpeed < MIN_TURN_SPEED || outSpeed < MIN_TURN_SPEED) continue
            var delta = bearing(current, next) - bearing(previous, current)
            while (delta > 180) delta -= 360
            while (delta < -180) delta += 360
            val dt = (next.t - previous.t) / 1000.0
            if (dt <= 0.3 || abs(delta) < MIN_TURN_DEG) continue
            if (lastAt > 0 && current.t - lastAt < TURN_DEBOUNCE_MS) continue
            lastAt = current.t
            add(RideEvent(
                t = current.t,
                lat = current.lat,
                lng = current.lng,
                kind = "sharp_turn",
                magnitude = abs(delta) / dt,
                speedKph = maxOf(inSpeed, outSpeed) * 3.6
            ))
        }
    }

    fun roadScore(impacts: List<SavedImpact>, distanceM: Double): RoadScore {
        val km = (if (distanceM.isFinite() && distanceM > 0) distanceM else 0.0) / 1000.0
        val effectiveKm = maxOf(km, 0.25)
        var stress = 0.0
        var worst: SavedImpact? = null
        for (impact in impacts) {
            stress += when (impact.severity) {
                3 -> 5.0
                2 -> 2.5
                else -> 1.0
            }
            if (worst == null || impact.severity > worst.severity) worst = impact
        }
        val defectsPerKm = if (km > 0) impacts.size / km else 0.0
        return scoreOf(stress / effectiveKm, defectsPerKm, worst?.kind)
    }

    /** Summary-level score when only counts are available (journey list). */
    fun roadScore(impactCount: Int, distanceM: Double): RoadScore {
        val km = (if (distanceM.isFinite() && distanceM > 0) distanceM else 0.0) / 1000.0
        val effectiveKm = maxOf(km, 0.25)
        val stress = maxOf(0, impactCount) * 2.5
        val defectsPerKm = if (km > 0) impactCount / km else 0.0
        return scoreOf(stress / effectiveKm, defectsPerKm, null)
    }

    private fun scoreOf(stressPerKm: Double, defectsPerKm: Double, worstKind: String?): RoadScore {
        val score = (100 - stressPerKm * 5).roundToInt().coerceIn(0, 100)
        val grade = when {
            score >= 85 -> "Smooth"
            score >= 60 -> "Fair"
            score >= 35 -> "Rough"
            else -> "Severe"
        }
        return RoadScore(score, grade, defectsPerKm, worstKind)
    }

    /** Metres from the start of the ride to the closest fix of a point. */
    fun distanceAlongMeters(fixes: List<SavedFix>, lat: Double, lng: Double): Double {
        if (fixes.isEmpty()) return 0.0
        var bestIndex = 0
        var best = Double.MAX_VALUE
        for (i in fixes.indices) {
            val dLat = fixes[i].lat - lat
            val dLng = fixes[i].lng - lng
            val approx = dLat * dLat + dLng * dLng
            if (approx < best) {
                best = approx
                bestIndex = i
            }
        }
        var total = 0.0
        for (i in 1..bestIndex) {
            total += haversine(fixes[i - 1], fixes[i])
        }
        return total
    }

    /** Consecutive local days with at least one journey, ending today or yesterday. */
    fun dayStreak(
        trips: List<RoadTrip>,
        nowMillis: Long,
        timeZone: TimeZone = TimeZone.getDefault()
    ): Int {
        if (trips.isEmpty()) return 0
        val calendar = Calendar.getInstance(timeZone)
        fun key(millis: Long): Int {
            calendar.timeInMillis = millis
            return calendar.get(Calendar.YEAR) * 400 + calendar.get(Calendar.DAY_OF_YEAR)
        }
        val days = trips.map { key(it.at) }.toHashSet()
        val today = Calendar.getInstance(timeZone).apply {
            timeInMillis = nowMillis
        }
        val todayKey = key(today.timeInMillis)
        val yesterday = (today.clone() as Calendar).apply {
            add(Calendar.DAY_OF_MONTH, -1)
        }
        val yesterdayKey = key(yesterday.timeInMillis)
        if (!days.contains(todayKey) && !days.contains(yesterdayKey)) return 0
        val cursor = (today.clone() as Calendar).apply {
            if (!days.contains(todayKey)) add(Calendar.DAY_OF_MONTH, -1)
        }
        var streak = 0
        while (streak < 365) {
            if (!days.contains(key(cursor.timeInMillis))) break
            streak++
            cursor.add(Calendar.DAY_OF_MONTH, -1)
        }
        return streak
    }
}

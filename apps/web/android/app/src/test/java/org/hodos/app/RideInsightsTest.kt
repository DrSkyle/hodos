package org.hodos.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class RideInsightsTest {

    private fun fix(t: Long, lat: Double, lng: Double, speed: Double) =
        SavedFix(t, lat, lng, speed)

    @Test
    fun harshBrakingIsDetected() {
        val events = RideInsights.harshBraking(listOf(
            fix(0, 0.0, 0.0, 16.0),
            fix(1_000, 0.000144, 0.0, 16.0),
            fix(2_000, 0.000235, 0.0, 9.0)
        ))
        assertEquals(1, events.size)
        assertEquals("harsh_brake", events[0].kind)
        assertTrue(events[0].magnitude >= 3.0)
    }

    @Test
    fun steadyCruiseIsNotHarshBraking() {
        val events = RideInsights.harshBraking(listOf(
            fix(0, 0.0, 0.0, 12.0),
            fix(1_000, 0.000108, 0.0, 12.0),
            fix(2_000, 0.000216, 0.0, 12.0)
        ))
        assertTrue(events.isEmpty())
    }

    @Test
    fun missingSpeedFixDoesNotLookLikeABrake() {
        // The last fix reports no speed, but displacement shows the ride is
        // still moving, so this must not be treated as a stop.
        val events = RideInsights.harshBraking(listOf(
            fix(0, 0.0, 0.0, 14.0),
            fix(1_000, 0.000126, 0.0, 0.0)
        ))
        assertTrue(events.isEmpty())
    }

    @Test
    fun sharpCornerIsDetected() {
        val events = RideInsights.sharpTurns(listOf(
            fix(0, 0.0, 0.0, 5.0),
            fix(2_000, 0.0, 0.000100, 5.0),
            fix(4_000, 0.000100, 0.000100, 5.0)
        ))
        assertEquals(1, events.size)
        assertEquals("sharp_turn", events[0].kind)
    }

    @Test
    fun straightLineHasNoCornerEvents() {
        val events = RideInsights.sharpTurns(listOf(
            fix(0, 0.0, 0.0, 6.0),
            fix(2_000, 0.0, 0.000120, 6.0),
            fix(4_000, 0.0, 0.000240, 6.0)
        ))
        assertTrue(events.isEmpty())
    }

    @Test
    fun roadScoreGradesHeavyDefectsAsSevere() {
        val impacts = listOf(
            SavedImpact(0, 0.0, 0.0, "pothole", 3),
            SavedImpact(1, 0.0, 0.0, "pothole", 3),
            SavedImpact(2, 0.0, 0.0, "rough_pavement", 3)
        )
        val score = RideInsights.roadScore(impacts, 1_000.0)
        assertEquals(25, score.score)
        assertEquals("Severe", score.grade)
    }

    @Test
    fun cleanRideScoresSmooth() {
        val score = RideInsights.roadScore(emptyList(), 5_000.0)
        assertEquals(100, score.score)
        assertEquals("Smooth", score.grade)
    }

    @Test
    fun distanceAlongFindsPositionInRide() {
        val fixes = listOf(
            fix(0, 0.0, 0.0, 10.0),
            fix(1_000, 0.0, 0.000090, 10.0),  // ~10 m
            fix(2_000, 0.0, 0.000180, 10.0)   // ~20 m
        )
        val distance = RideInsights.distanceAlongMeters(fixes, 0.0, 0.000180)
        assertTrue(distance > 15.0 && distance < 25.0)
    }

    @Test
    fun continuousDaysMakeAStreak() {
        val utc = TimeZone.getTimeZone("UTC")
        val now = Calendar.getInstance(utc).apply {
            clear()
            set(2026, Calendar.NOVEMBER, 8, 12, 0, 0)
        }.timeInMillis
        val trips = listOf(
            RoadTrip(now, 1, 0, 0, 1000.0),
            RoadTrip(now - 86_400_000L, 1, 0, 0, 1000.0),
            RoadTrip(now - 2 * 86_400_000L, 1, 0, 0, 1000.0)
        )
        assertEquals(3, RideInsights.dayStreak(trips, now, utc))
    }

    @Test
    fun staleStreakResetsToZero() {
        val utc = TimeZone.getTimeZone("UTC")
        val now = Calendar.getInstance(utc).apply {
            clear()
            set(2026, Calendar.NOVEMBER, 8, 12, 0, 0)
        }.timeInMillis
        val trips = listOf(RoadTrip(now - 5 * 86_400_000L, 1, 0, 0, 1000.0))
        assertEquals(0, RideInsights.dayStreak(trips, now, utc))
    }
}

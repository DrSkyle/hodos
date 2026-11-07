package org.hodos.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationFixPolicyTest {
    private val now = 1_700_000_000_000L

    @Test fun thirtySecondFixMayBeUsedImmediately() {
        assertTrue(LocationFixPolicy.isFresh(now - 29_999L, now))
        assertTrue(LocationFixPolicy.isFresh(now - 30_000L, now))
        assertFalse(LocationFixPolicy.isFresh(now - 30_001L, now))
    }

    @Test fun onlyRecentFixesMayBeUsedAtTimeout() {
        assertTrue(LocationFixPolicy.isFallbackCandidate(now - 14 * 60_000L, now))
        assertFalse(LocationFixPolicy.isFallbackCandidate(now - 16 * 60_000L, now))
        assertFalse(LocationFixPolicy.isFresh(now - 14 * 60_000L, now))
    }

    @Test fun missingOrFutureTimestampsAreNeverTreatedAsFresh() {
        assertFalse(LocationFixPolicy.isFresh(0, now))
        assertFalse(LocationFixPolicy.isFallbackCandidate(now + 5_000L, now))
        assertFalse(LocationFixPolicy.isFresh(-1, now))
    }

    @Test fun roadEvidenceRequiresFreshAccuratePlausibleLocation() {
        fun accepts(time: Long = now, lat: Double = 28.2, accuracy: Float = 8f,
                    speed: Float = 3f, hasSpeed: Boolean = true, mocked: Boolean = false) =
            LocationFixPolicy.validRoadFix(time, now, lat, 84.0, accuracy, speed, hasSpeed, mocked)
        assertTrue(accepts())
        assertTrue(accepts(speed = 0f, hasSpeed = false))
        assertFalse(accepts(time = now - 30_001L))
        assertFalse(accepts(time = now + 1L))
        assertFalse(accepts(lat = Double.NaN))
        assertFalse(accepts(accuracy = Float.NaN))
        assertFalse(accepts(accuracy = 51f))
        assertFalse(accepts(accuracy = -1f))
        assertFalse(accepts(speed = Float.POSITIVE_INFINITY))
        assertFalse(accepts(speed = 75f))
        assertFalse(accepts(speed = -1f))
        assertFalse(accepts(mocked = true))
    }

    @Test fun plausibleTransitionRejectsMultipathJumpsAndBackwardsTimestamps() {
        assertTrue(LocationFixPolicy.plausibleTransition(now, now + 2_000L, 32.0))
        assertTrue(LocationFixPolicy.plausibleTransition(now, now + 2_000L, 120.0))
        assertFalse(LocationFixPolicy.plausibleTransition(now, now + 2_000L, 450.0))
        assertFalse(LocationFixPolicy.plausibleTransition(now, now, 10.0))
        assertFalse(LocationFixPolicy.plausibleTransition(now + 1_000L, now, 10.0))
        assertFalse(LocationFixPolicy.plausibleTransition(now, now + 2_000L, -5.0))
    }

    @Test fun invalidCoordinatesCannotCenterTheMap() {
        assertTrue(LocationFixPolicy.validCoordinates(28.2, 84.0))
        assertTrue(LocationFixPolicy.validCoordinates(-90.0, 180.0))
        assertFalse(LocationFixPolicy.validCoordinates(Double.NaN, 84.0))
        assertFalse(LocationFixPolicy.validCoordinates(91.0, 84.0))
        assertFalse(LocationFixPolicy.validCoordinates(28.2, 181.0))
        assertFalse(LocationFixPolicy.validCoordinates(Double.POSITIVE_INFINITY, 84.0))
    }
}

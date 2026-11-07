package org.hodos.app

/**
 * Strict age and coordinate checks for cached fixes.
 *
 * Browser/map rendering can fail or load slowly without affecting location.
 * The user's last location is reused only when it is genuinely recent.
 */
internal object LocationFixPolicy {
    private const val FRESH_AGE_MS = 30_000L
    private const val FALLBACK_AGE_MS = 15 * 60_000L

    fun isFresh(fixMillis: Long, nowMillis: Long): Boolean =
        ageInRange(fixMillis, nowMillis, FRESH_AGE_MS)

    fun isFallbackCandidate(fixMillis: Long, nowMillis: Long): Boolean =
        ageInRange(fixMillis, nowMillis, FALLBACK_AGE_MS)

    private fun ageInRange(fixMillis: Long, nowMillis: Long, maxAgeMillis: Long): Boolean =
        fixMillis > 0L && nowMillis >= fixMillis &&
            nowMillis - fixMillis <= maxAgeMillis

    /** Reject stale, inaccurate, implausibly fast, or malformed fixes before recording road evidence. */
    @JvmStatic
    fun validRoadFix(
        fixMillis: Long, nowMillis: Long, latitude: Double, longitude: Double,
        accuracyMeters: Float, speedMetersPerSecond: Float, hasSpeed: Boolean, mocked: Boolean
    ): Boolean =
        !mocked && isFresh(fixMillis, nowMillis) && validCoordinates(latitude, longitude) &&
            accuracyMeters.isFinite() && accuracyMeters in 0f..50f &&
            (!hasSpeed || (speedMetersPerSecond.isFinite() && speedMetersPerSecond in 0f..70f))

    /**
     * Reject impossible GPS multipath jumps between consecutive fixes while allowing
     * ordinary location jitter (<= 45 m/s * dt + 30 m).
     */
    @JvmStatic
    fun plausibleTransition(prevMillis: Long, currentMillis: Long, distanceMeters: Double): Boolean {
        if (currentMillis <= prevMillis || !distanceMeters.isFinite() || distanceMeters < 0.0) {
            return false
        }
        val elapsedSeconds = (currentMillis - prevMillis) / 1000.0
        return distanceMeters <= elapsedSeconds * 45.0 + 30.0
    }

    @JvmStatic
    fun validCoordinates(latitude: Double, longitude: Double): Boolean =
        latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
}

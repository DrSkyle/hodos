package org.hodos.app

/**
 * Pure, deterministic decisions for a MapLibre offline region.
 *
 * Keeping this separate from Android callbacks lets CI test download-state
 * transitions without relying on a network connection or a tile provider.
 */
internal object OfflineDownloadPolicy {
    const val MAX_TILES = 2_400L
    const val MAX_BYTES = 45L * 1024L * 1024L
    const val MAX_AUTO_LOCATION_ACCURACY_METERS = 2_500f

    enum class Decision { CONTINUE, WAIT_FOR_WIFI, COMPLETE, PROVIDER_LIMIT }

    fun evaluate(
        wifi: Boolean,
        complete: Boolean,
        preciseCount: Boolean,
        requiredResources: Long,
        completedTiles: Long,
        completedBytes: Long
    ): Decision {
        if (!wifi) return Decision.WAIT_FOR_WIFI
        // A region newly created with zero resources has NOT been downloaded.
        if (complete && preciseCount && requiredResources > 0L) return Decision.COMPLETE
        if (completedTiles >= MAX_TILES || completedBytes >= MAX_BYTES) {
            return Decision.PROVIDER_LIMIT
        }
        return Decision.CONTINUE
    }

    fun safeForAutomaticDownload(hasAccuracy: Boolean, accuracyMeters: Float): Boolean =
        hasAccuracy && accuracyMeters.isFinite() && accuracyMeters >= 0 &&
            accuracyMeters <= MAX_AUTO_LOCATION_ACCURACY_METERS
}

package org.hodos.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineDownloadPolicyTest {
    private fun decision(
        wifi: Boolean = true,
        complete: Boolean = false,
        precise: Boolean = true,
        required: Long = 200,
        tiles: Long = 15,
        bytes: Long = 12_000
    ) = OfflineDownloadPolicy.evaluate(wifi, complete, precise, required, tiles, bytes)

    @Test fun pausedAsSoonAsWifiIsLostEvenIfAndroidIsStillReportingCompletion() {
        assertEquals(OfflineDownloadPolicy.Decision.WAIT_FOR_WIFI,
            decision(wifi = false, complete = true))
    }

    @Test fun neverCallEmptyOrImpreciseRegionReady() {
        assertEquals(OfflineDownloadPolicy.Decision.CONTINUE,
            decision(complete = true, required = 0))
        assertEquals(OfflineDownloadPolicy.Decision.CONTINUE,
            decision(complete = true, precise = false))
    }

    @Test fun genuinelyFinishedPackIsReady() {
        assertEquals(OfflineDownloadPolicy.Decision.COMPLETE, decision(complete = true))
    }

    @Test fun providerCapStopsIncompleteTileDownload() {
        assertEquals(OfflineDownloadPolicy.Decision.PROVIDER_LIMIT,
            decision(tiles = OfflineDownloadPolicy.MAX_TILES))
        assertEquals(OfflineDownloadPolicy.Decision.PROVIDER_LIMIT,
            decision(bytes = OfflineDownloadPolicy.MAX_BYTES))
    }

    @Test fun completedPackIsNotFalselyReportedAsInterruptedAtTheLimit() {
        assertEquals(OfflineDownloadPolicy.Decision.COMPLETE,
            decision(complete = true, tiles = OfflineDownloadPolicy.MAX_TILES))
    }

    @Test fun approximateLocationNeedsManualConfirmationRatherThanAutoDownload() {
        assertTrue(OfflineDownloadPolicy.safeForAutomaticDownload(true, 15f))
        assertTrue(OfflineDownloadPolicy.safeForAutomaticDownload(true, 2400f))
        assertFalse(OfflineDownloadPolicy.safeForAutomaticDownload(false, 0f))
        assertFalse(OfflineDownloadPolicy.safeForAutomaticDownload(true, 10000f))
        assertFalse(OfflineDownloadPolicy.safeForAutomaticDownload(true, Float.NaN))
    }
}

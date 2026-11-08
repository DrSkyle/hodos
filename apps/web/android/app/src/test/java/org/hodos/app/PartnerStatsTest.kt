package org.hodos.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PartnerStatsTest {

    private fun hazard(lat: Double, lng: Double, devices: Int, passes: Int) =
        RoadHazard(
            id = "$lat:$lng",
            lat = lat,
            lng = lng,
            kind = "pothole",
            severity = 2,
            passes = passes,
            devices = devices,
            confidence = 0.8,
            clearPasses = 0,
            fixed = false,
            lastSeen = ""
        )

    @Test
    fun countsOnlyHazardsNearTheShop() {
        val shopLat = 51.5000
        val shopLng = -0.1200
        val nearby = PartnerStats.nearby(
            listOf(
                hazard(51.5005, -0.1201, devices = 4, passes = 9),
                hazard(51.5100, -0.1200, devices = 9, passes = 20)
            ),
            shopLat, shopLng
        )
        assertEquals(1, nearby.reports)
        assertEquals(4, nearby.maxDevices)
        assertEquals(9, nearby.maxPasses)
        assertTrue(nearby.hasSignal)
    }

    @Test
    fun emptyAreaHasNoSignal() {
        val nearby = PartnerStats.nearby(emptyList(), 51.5, -0.12)
        assertFalse(nearby.hasSignal)
        assertEquals(0, nearby.maxDevices)
    }
}

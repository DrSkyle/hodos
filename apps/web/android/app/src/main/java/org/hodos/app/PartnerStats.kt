package org.hodos.app

/**
 * Conservative, real activity signal for a partner shop derived from the public
 * hazard map that every client already holds. It cannot count every pass (that
 * needs the aggregation function), but it proves nearby driver activity without
 * knowing who anyone is.
 */
object PartnerStats {
    private const val NEARBY_RADIUS_M = 400.0

    data class Nearby(
        val reports: Int,
        val maxDevices: Int,
        val maxPasses: Int
    ) {
        val hasSignal: Boolean get() = reports > 0
    }

    fun nearby(hazards: List<RoadHazard>, lat: Double, lng: Double): Nearby {
        var reports = 0
        var devices = 0
        var passes = 0
        for (hazard in hazards) {
            if (distance(lat, lng, hazard.lat, hazard.lng) > NEARBY_RADIUS_M) continue
            reports++
            devices = maxOf(devices, hazard.devices)
            passes = maxOf(passes, hazard.passes)
        }
        return Nearby(reports, devices, passes)
    }

    private fun distance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
        return 2 * 6_371_008.8 * Math.asin(minOf(1.0, Math.sqrt(s)))
    }
}

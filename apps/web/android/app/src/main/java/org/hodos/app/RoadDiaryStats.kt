package org.hodos.app

import java.util.Calendar
import java.util.TimeZone

/**
 * Journey summaries only. No coordinates, user identity or remote analytics.
 * Local civil-day boundaries (rather than 24h arithmetic) handle DST correctly.
 */
internal data class RoadDiarySummary(
    val journeysThisWeek: Int,
    val activeDaysThisWeek: Int,
    val distanceMetersThisWeek: Double,
    val activeDays: List<Boolean>
)

internal fun summarizeRoadDiary(
    trips: List<RoadTrip>,
    nowMillis: Long,
    timeZone: TimeZone = TimeZone.getDefault()
): RoadDiarySummary {
    val monday = Calendar.getInstance(timeZone).apply {
        timeInMillis = nowMillis
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
        while (get(Calendar.DAY_OF_WEEK) != Calendar.MONDAY) {
            add(Calendar.DAY_OF_MONTH, -1)
        }
    }
    val boundaries = LongArray(8)
    val day = monday.clone() as Calendar
    for (i in boundaries.indices) {
        boundaries[i] = day.timeInMillis
        day.add(Calendar.DAY_OF_MONTH, 1)
    }

    val active = BooleanArray(7)
    var count = 0
    var distance = 0.0
    for (trip in trips) {
        if (trip.at <= 0L || trip.at > nowMillis ||
            trip.at < boundaries[0] || trip.at >= boundaries[7]
        ) continue
        val index = (0 until 7).firstOrNull {
            trip.at >= boundaries[it] && trip.at < boundaries[it + 1]
        } ?: continue
        active[index] = true
        count++
        if (trip.distanceM.isFinite() && trip.distanceM >= 0.0) {
            distance += trip.distanceM
        }
    }
    return RoadDiarySummary(count, active.count { it }, distance, active.toList())
}

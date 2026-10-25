package org.hodos.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class RoadDiaryStatsTest {
    private val utc = TimeZone.getTimeZone("UTC")
    private fun at(year: Int, month: Int, date: Int, hour: Int = 12,
                   zone: TimeZone = utc): Long =
        Calendar.getInstance(zone).apply {
            clear()
            set(year, month - 1, date, hour, 0, 0)
        }.timeInMillis

    private fun trip(at: Long, distance: Double = 1250.0) =
        RoadTrip(at, 0, 0, 0, distance)

    @Test fun emptyHistoryHasNoArtificialProgress() {
        val result = summarizeRoadDiary(emptyList(), at(2026, 10, 28), utc)
        assertEquals(0, result.journeysThisWeek)
        assertEquals(0, result.activeDaysThisWeek)
        assertEquals(7, result.activeDays.size)
        assertTrue(result.activeDays.none { it })
    }

    @Test fun countsRealJourneysAndDistinctLocalDays() {
        val now = at(2026, 10, 28, 20)
        val result = summarizeRoadDiary(listOf(
            trip(at(2026, 10, 26, 8)),
            trip(at(2026, 10, 26, 19)),
            trip(at(2026, 10, 28, 9), 700.0)
        ), now, utc)
        assertEquals(3, result.journeysThisWeek)
        assertEquals(2, result.activeDaysThisWeek)
        assertEquals(3200.0, result.distanceMetersThisWeek, 0.001)
        assertEquals(listOf(true, false, true, false, false, false, false),
            result.activeDays)
    }

    @Test fun previousWeekFutureRecordsAndBadDistancesCannotInflateTotals() {
        val now = at(2026, 10, 26, 16)
        val result = summarizeRoadDiary(listOf(
            trip(at(2026, 10, 25, 23)),
            trip(at(2026, 10, 26, 9), Double.NaN),
            trip(at(2026, 10, 26, 11), -9.0),
            trip(at(2026, 10, 27, 11))
        ), now, utc)
        assertEquals(2, result.journeysThisWeek)
        assertEquals(1, result.activeDaysThisWeek)
        assertEquals(0.0, result.distanceMetersThisWeek, 0.001)
        assertTrue(result.activeDays[0])
        assertFalse(result.activeDays[6])
    }

    @Test fun timezoneUsesLocalMondayRatherThanUtcMonday() {
        val nepal = TimeZone.getTimeZone("Asia/Kathmandu")
        val now = at(2026, 10, 26, 1, nepal)
        val result = summarizeRoadDiary(listOf(
            trip(at(2026, 10, 25, 23, nepal)),
            trip(at(2026, 10, 26, 0, nepal))
        ), now, nepal)
        assertEquals(1, result.journeysThisWeek)
        assertTrue(result.activeDays[0])
    }
}

package org.hodos.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class PerksTest {
    private val utc = TimeZone.getTimeZone("UTC")

    private fun at(year: Int, month: Int, date: Int, hour: Int = 12): Long =
        Calendar.getInstance(utc).apply {
            clear()
            set(year, month - 1, date, hour, 0, 0)
        }.timeInMillis

    private fun trip(at: Long, meters: Double) = RoadTrip(at, 0, 0, 0, meters)

    @Test
    fun onlyTheCurrentMonthCounts() {
        val now = at(2026, 11, 8)
        val summary = Perks.summarize(
            listOf(
                trip(at(2026, 11, 7), 12_000.0),
                trip(at(2026, 10, 30), 90_000.0)
            ),
            now, utc, "seed"
        )
        assertEquals(12.0, summary.monthlyKm, 0.001)
        assertEquals(1, summary.monthlyJourneys)
    }

    @Test
    fun tiersUnlockAtDistance() {
        val now = at(2026, 11, 8)
        val summary = Perks.summarize(
            listOf(trip(now, 55_000.0)), now, utc, "seed"
        )
        assertEquals(2, summary.unlocked.size)
        assertEquals("chain_lube", summary.unlocked.last().id)
        assertEquals("alignment", summary.next?.id)
        assertTrue(summary.progress in 0f..1f)
        assertNotNull(summary.code)
    }

    @Test
    fun noCodeBeforeFirstTier() {
        val now = at(2026, 11, 8)
        val summary = Perks.summarize(
            listOf(trip(now, 5_000.0)), now, utc, "seed"
        )
        assertEquals(0, summary.unlocked.size)
        assertNull(summary.code)
        assertEquals("tire_check", summary.next?.id)
    }

    @Test
    fun codeIsStableWithinTheMonth() {
        val now = at(2026, 11, 8)
        val trips = listOf(trip(now, 30_000.0))
        val first = Perks.summarize(trips, now, utc, "device-a").code
        val second = Perks.summarize(trips, now, utc, "device-a").code
        assertEquals(first, second)
        assertTrue(first!!.startsWith("HODOS-"))
    }
}

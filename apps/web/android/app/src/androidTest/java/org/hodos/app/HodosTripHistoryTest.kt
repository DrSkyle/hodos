package org.hodos.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class HodosTripHistoryTest {
    @Test fun summariesArePersistentBoundedAndContainNoCoordinates() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences(
            "test-trip-history-${UUID.randomUUID()}", Context.MODE_PRIVATE
        )
        try {
            repeat(60) { i ->
                assertTrue(TripHistory.record(
                    prefs, 1_700_000_000_000L + i, i, i * 2, 1250.0
                ))
            }
            val persisted = JSONArray(prefs.getString("autoTrips", "[]"))
            assertEquals(50, persisted.length())
            assertEquals(10, persisted.getJSONObject(0).getInt("impacts"))
            assertEquals(59, persisted.getJSONObject(49).getInt("impacts"))
            assertEquals(118, persisted.getJSONObject(49).getInt("gpsFixes"))
            assertEquals(1250L, persisted.getJSONObject(49).getLong("distanceM"))
            assertFalse(prefs.getString("autoTrips", "")!!.contains("latitude"))
            assertFalse(prefs.getString("autoTrips", "")!!.contains("longitude"))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test fun localHistoryCanBeClearedWithoutChangingOtherPreferences() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences(
            "test-trip-history-${UUID.randomUUID()}", Context.MODE_PRIVATE
        )
        try {
            prefs.edit().putString("otherSetting", "preserved").commit()
            assertTrue(TripHistory.record(prefs, 12345L, 2, 12, 240.0))
            assertTrue(TripHistory.clear(prefs))
            assertEquals("[]", prefs.getString("autoTrips", "[]"))
            assertEquals("preserved", prefs.getString("otherSetting", ""))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test fun invalidJourneyDoesNotOverwritePreviousHistory() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences(
            "test-trip-history-${UUID.randomUUID()}", Context.MODE_PRIVATE
        )
        try {
            assertTrue(TripHistory.record(prefs, 12345L, 1, 22, 320.0))
            val prior = prefs.getString("autoTrips", "")
            assertFalse(TripHistory.record(prefs, 0L, -1, 2, Double.NaN))
            assertEquals(prior, prefs.getString("autoTrips", ""))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test fun recordOrUpdateUpdatesActiveTripMetricsInPlace() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences(
            "test-trip-history-${UUID.randomUUID()}", Context.MODE_PRIVATE
        )
        try {
            val tripId = "trip-${UUID.randomUUID()}"
            assertTrue(TripHistory.recordOrUpdate(prefs, tripId, 1_700_000_000_000L, 2, 10, 500.0, 60L))
            var trips = JSONArray(prefs.getString("autoTrips", "[]"))
            assertEquals(1, trips.length())
            assertEquals(2, trips.getJSONObject(0).getInt("impacts"))
            assertEquals(500L, trips.getJSONObject(0).getLong("distanceM"))

            // Periodic checkpoint updates in-place
            assertTrue(TripHistory.recordOrUpdate(prefs, tripId, 1_700_000_000_000L, 7, 35, 2400.0, 360L))
            trips = JSONArray(prefs.getString("autoTrips", "[]"))
            assertEquals(1, trips.length())
            assertEquals(7, trips.getJSONObject(0).getInt("impacts"))
            assertEquals(35, trips.getJSONObject(0).getInt("gpsFixes"))
            assertEquals(2400L, trips.getJSONObject(0).getLong("distanceM"))
            assertEquals(360L, trips.getJSONObject(0).getLong("durationS"))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test fun recordOrUpdateAppendsNewTripWhenTripIdChanges() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences(
            "test-trip-history-${UUID.randomUUID()}", Context.MODE_PRIVATE
        )
        try {
            assertTrue(TripHistory.recordOrUpdate(prefs, "trip-1", 1_000L, 1, 5, 200.0, 30L))
            assertTrue(TripHistory.recordOrUpdate(prefs, "trip-2", 2_000L, 4, 18, 900.0, 150L))
            val trips = JSONArray(prefs.getString("autoTrips", "[]"))
            assertEquals(2, trips.length())
            assertEquals("trip-1", trips.getJSONObject(0).getString("tripId"))
            assertEquals("trip-2", trips.getJSONObject(1).getString("tripId"))
        } finally {
            prefs.edit().clear().commit()
        }
    }
}

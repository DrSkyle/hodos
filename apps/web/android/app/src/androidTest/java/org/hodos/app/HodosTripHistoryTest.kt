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
}

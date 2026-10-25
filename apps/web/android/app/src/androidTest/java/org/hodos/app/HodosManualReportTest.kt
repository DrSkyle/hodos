package org.hodos.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Date

/**
 * No remote calls or fake road submissions: manually composed reports are
 * verified entirely within app-private test storage.
 */
@RunWith(AndroidJUnit4::class)
class HodosManualReportTest {
    private fun hazard() = RoadHazard(
        id = "manual-test-hazard",
        lat = 27.7172,
        lng = 85.324,
        kind = "pothole",
        severity = 2,
        passes = 3,
        devices = 2,
        confidence = 0.7,
        clearPasses = 0,
        fixed = false,
        lastSeen = "2026-10-25T00:00:00Z"
    )

    @Test fun manuallyReportedFixIsConservativeAndHasNoInventedSpeed() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val report = HazardRepository(app).manualPayload(
            hazard(), true, "test-device", Date(1_700_000_000_000L)
        )
        assertEquals("fix", report.getString("observation"))
        assertEquals("manual-test-hazard", report.getString("hazardRef"))
        assertEquals(100.0, report.getDouble("accuracy"), 0.001)
        assertEquals(0.0, report.getDouble("speedKph"), 0.001)
        assertEquals(0.35, report.getDouble("confidence"), 0.001)
        assertEquals("test-device", report.getString("deviceId"))
        assertTrue(report.has("tripId"))
        assertTrue(report.getString("recordedAt").endsWith("Z"))
    }

    @Test fun manualPresenceAndRepairAreDistinctEvidenceTypes() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val repository = HazardRepository(app)
        val present = repository.manualPayload(hazard(), false, "test-device")
        val repaired = repository.manualPayload(hazard(), true, "test-device")
        assertEquals("impact", present.getString("observation"))
        assertEquals("fix", repaired.getString("observation"))
        assertFalse(present.getString("tripId") == repaired.getString("tripId"))
    }
}

package org.hodos.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

/** Pure parsing tests: no network, real uploads, or production data changes. */
@RunWith(AndroidJUnit4::class)
class HodosHazardSnapshotTest {
    private val repository by lazy {
        HazardRepository(ApplicationProvider.getApplicationContext<Context>())
    }

    private fun row(): JSONObject = JSONObject()
        .put(36.toChar().toString() + "id", "pothole-test")
        .put("published", true)
        .put("lat", 27.7172)
        .put("lng", 85.324)
        .put("confidence", 0.8)
        .put("kind", "pothole")
        .put("severity", 2)
        .put("passCount", 4)
        .put("deviceCount", 3)

    @Test fun emptyRealSnapshotIsValidButMissingRowsAreNot() {
        assertEquals(0, repository.decodeSnapshot("""{"rows":[]}""").size)
        assertThrows(IllegalStateException::class.java) {
            repository.decodeSnapshot("""{"message":"temporarily unavailable"}""")
        }
    }

    @Test fun validPublishedRowCanBeReadAndAnUnpublishedRowIsHidden() {
        val raw = JSONObject().put("rows", JSONArray()
            .put(row())
            .put(row().put("published", false))
        ).toString()
        val hazards = repository.decodeSnapshot(raw)
        assertEquals(1, hazards.size)
        assertEquals("pothole-test", hazards.single().id)
        assertEquals(0.8, hazards.single().confidence, 0.0001)
    }

    @Test fun malformedPublishedHazardCannotReplaceACachedMap() {
        for (bad in arrayOf(
            row().put("lat", JSONObject.NULL),
            row().put("lat", "27.7172"),
            row().put("confidence", 9),
            row().put("published", "true"),
            row().put("kind", "unknown"),
            row().put("severity", 0)
        )) {
            val raw = JSONObject().put("rows", JSONArray().put(bad)).toString()
            assertThrows(RuntimeException::class.java) {
                repository.decodeSnapshot(raw)
            }
        }
    }
}

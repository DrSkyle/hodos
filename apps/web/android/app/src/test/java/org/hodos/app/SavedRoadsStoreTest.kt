package org.hodos.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedRoadsStoreTest {
    @Test fun rejectsInvalidIdentifiersAndDuplicates() {
        val result = SavedRoadsStore.normalize(
            listOf("road-1", "road-1", "", "a/b", "a b", "road_2", "$"+"bad")
        )
        assertEquals(setOf("road-1", "road_2"), result)
    }

    @Test fun limitsBookmarksToAvoidUnboundedLocalStorage() {
        val result = SavedRoadsStore.normalize((0..150).map { "road_$it" })
        assertEquals(100, result.size)
        assertTrue("road_0" in result)
        assertFalse("road_150" in result)
    }
}

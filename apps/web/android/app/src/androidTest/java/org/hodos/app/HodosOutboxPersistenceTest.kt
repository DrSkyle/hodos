package org.hodos.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * Verify durability and retry safety against Android's real SQLiteDatabase.
 * No network traffic, fake user coordinates or production backend writes.
 */
@RunWith(AndroidJUnit4::class)
class HodosOutboxPersistenceTest {
    @Test
    fun queuedEventsSurviveClosingTheDatabaseAndRetainStableIds() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val id = "smoke-${UUID.randomUUID()}"
        val payload = """{"observation":"impact","kind":"pothole"}"""
        val first = EventOutbox(app)
        try {
            assertTrue("First insert must persist", first.enqueue(id, payload))
            assertFalse("Duplicate ID must not create more evidence", first.enqueue(id, payload))
        } finally {
            first.close()
        }

        val reopened = EventOutbox(app)
        try {
            val retained = reopened.pending(200).filter { it.id == id }
            assertEquals("Evidence must survive helper recreation", 1, retained.size)
            assertEquals(payload, retained.single().payload)
            reopened.acknowledge(id)
            assertTrue("Only confirmed rows should be acknowledged",
                reopened.pending(200).none { it.id == id })
        } finally {
            reopened.acknowledge(id)
            reopened.close()
        }
    }
}

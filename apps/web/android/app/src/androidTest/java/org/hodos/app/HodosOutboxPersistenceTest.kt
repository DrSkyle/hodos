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
        val databaseName = "hodos-queue-test-${UUID.randomUUID()}.db"
        val first = EventOutbox(app, databaseName)
        try {
            assertTrue("First insert must persist", first.enqueue(id, payload))
            assertFalse("Duplicate ID must not create more evidence", first.enqueue(id, payload))
        } finally {
            first.close()
        }

        val reopened = EventOutbox(app, databaseName)
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
            app.deleteDatabase(databaseName)
        }
    }

    @Test
    fun rejectedEventIsRetainedPrivatelyWithoutBlockingLaterEvents() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val rejectedId = "test-invalid-${UUID.randomUUID()}"
        val goodId = "test-valid-${UUID.randomUUID()}"
        val databaseName = "hodos-queue-test-${UUID.randomUUID()}.db"
        val db = EventOutbox(app, databaseName)
        try {
            val beforePending = db.pendingCount()
            val beforeRejected = db.rejectedCount()
            assertTrue(db.enqueue(rejectedId, """{"lat":27.7}"""))
            assertTrue(db.enqueue(goodId, """{"lat":27.8}"""))
            assertTrue(db.quarantine(rejectedId, 422))
            assertFalse(db.quarantine(rejectedId, 422))
            assertEquals(beforePending + 1, db.pendingCount())
            assertEquals(beforeRejected + 1, db.rejectedCount())
            assertTrue(db.pending(200).any { it.id == goodId })
            assertFalse(db.pending(200).any { it.id == rejectedId })
            db.acknowledge(goodId)
            assertEquals(beforePending, db.pendingCount())
            // Quarantined payloads survive helper recreation.
        } finally {
            db.acknowledge(goodId)
            db.close()
        }
        val reopened = EventOutbox(app, databaseName)
        try {
            assertTrue(reopened.rejectedCount() >= 1)
            assertFalse(reopened.pending(200).any { it.id == rejectedId })
        } finally {
            // Test data must not remain in the user's diagnostics table.
            reopened.deleteRejected(rejectedId)
            reopened.close()
            app.deleteDatabase(databaseName)
        }
    }

    @Test
    fun clearingUnsentReportsKeepsRejectedRecordsAndOtherDatabasesIntact() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "hodos-queue-test-${UUID.randomUUID()}.db"
        try {
            EventOutbox(app, databaseName).use { outbox ->
                assertTrue(outbox.enqueue("good-a", """{"kind":"pothole"}"""))
                assertTrue(outbox.enqueue("bad-b", """{"kind":"speed_bump"}"""))
                assertTrue(outbox.quarantine("bad-b", 422))
                assertEquals(1, outbox.pendingCount())
                assertEquals(1, outbox.rejectedCount())
                assertEquals(1, outbox.clearPending())
                assertEquals(0, outbox.pendingCount())
                assertEquals(1, outbox.rejectedCount())
                assertEquals(0, outbox.clearPending())
            }
        } finally {
            app.deleteDatabase(databaseName)
        }
    }
}

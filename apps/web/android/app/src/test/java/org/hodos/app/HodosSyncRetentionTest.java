package org.hodos.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

/** Pure policy tests. No system clock, WorkManager, network, or database. */
public final class HodosSyncRetentionTest {
  @Test public void anOlderTripMayNotRecreateEvidenceAfterDeletion() {
    assertFalse(HodosSyncWorker.mayPersistTrip(1_000L, 1_001L));
    assertFalse(HodosSyncWorker.mayPersistTrip(1_000L, 1_000L));
  }

  @Test public void newConsentedTripsCanStillUploadAfterDeletion() {
    assertTrue(HodosSyncWorker.mayPersistTrip(1_001L, 1_000L));
    assertTrue(HodosSyncWorker.mayPersistTrip(1_001L, 0L));
  }

  @Test public void uninitializedTripsCannotUpload() {
    assertFalse(HodosSyncWorker.mayPersistTrip(0L, 0L));
    assertFalse(HodosSyncWorker.mayPersistTrip(-1L, 0L));
  }
}

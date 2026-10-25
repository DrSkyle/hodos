package org.hodos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import org.junit.Test;

public final class ObservationIdsTest {
  @Test public void sameObservationKeepsItsRowIdAcrossRetries() {
    String first = ObservationIds.impactRowId("trip-42", 1700000000123L);
    assertEquals(first, ObservationIds.impactRowId("trip-42", 1700000000123L));
    assertEquals(36, first.length());
  }

  @Test public void distinctTripsAndTimesNeverAlias() {
    String first = ObservationIds.impactRowId("trip-42", 1700000000123L);
    assertNotEquals(first, ObservationIds.impactRowId("trip-42", 1700000001123L));
    assertNotEquals(first, ObservationIds.impactRowId("trip-43", 1700000000123L));
  }

  @Test(expected = IllegalArgumentException.class)
  public void missingTripIdIsRejected() {
    ObservationIds.impactRowId("", 1700000000123L);
  }

  @Test(expected = IllegalArgumentException.class)
  public void missingTimestampIsRejected() {
    ObservationIds.impactRowId("trip-42", 0);
  }
}

package org.hodos.app;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Deterministic row IDs prevent an impact from being counted twice on retry. */
final class ObservationIds {
  private ObservationIds() {}

  static String impactRowId(String tripId, long timestampMillis) {
    if (tripId == null || tripId.isEmpty() || timestampMillis <= 0) {
      throw new IllegalArgumentException("Impact needs a valid trip and timestamp");
    }
    return UUID.nameUUIDFromBytes(
        (tripId + ":" + timestampMillis).getBytes(StandardCharsets.UTF_8)).toString();
  }
}

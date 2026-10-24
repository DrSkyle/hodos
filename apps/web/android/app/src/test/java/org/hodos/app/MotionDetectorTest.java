package org.hodos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

/** Basic regression guards, not a substitute for labelled field recordings. */
public final class MotionDetectorTest {
  @Test public void noLocationDoesNotProduceGeolocatedHazards() {
    List<MotionDetector.Sample> samples = new ArrayList<>();
    for (int i = 0; i < 300; i++) {
      double impact = i == 120 ? 20.0 : 0.0;
      samples.add(new MotionDetector.Sample(1_700_000_000_000L + i * 20L, 0, 0, 9.81 + impact));
    }
    assertTrue(MotionDetector.detect(samples, Collections.emptyList()).isEmpty());
  }

  @Test public void noRoadMotionDoesNotProduceHazards() {
    List<MotionDetector.Sample> samples = new ArrayList<>();
    for (int i = 0; i < 300; i++) {
      samples.add(new MotionDetector.Sample(1_700_000_000_000L + i * 20L, 0, 0, 9.81));
    }
    List<MotionDetector.Fix> fixes = Collections.singletonList(
        new MotionDetector.Fix(1_700_000_003_000L, 27.7172, 85.324, 5, 14, true));
    assertTrue(MotionDetector.detect(samples, fixes).isEmpty());
  }

  @Test public void haversineHasExpectedScale() {
    assertEquals(0.0, MotionDetector.haversineMeters(27.7172, 85.324, 27.7172, 85.324), 0.001);
    assertEquals(111195.0, MotionDetector.haversineMeters(0, 0, 1, 0), 100);
  }
}

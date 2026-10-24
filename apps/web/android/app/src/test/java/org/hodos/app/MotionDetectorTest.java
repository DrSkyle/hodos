package org.hodos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
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

  private static final long START = 1_700_000_000_000L;

  private static MotionDetector.Fix movingFix(
      long deltaMs, double latDelta, double accuracy, double speed, boolean hasSpeed) {
    return new MotionDetector.Fix(START + deltaMs, 27.7172 + latDelta, 85.324,
        accuracy, speed, hasSpeed);
  }

  private static MotionDetector.Hazard knownHazard() {
    MotionDetector.Hazard h = new MotionDetector.Hazard();
    h.lat = 27.7172;
    h.lng = 85.324;
    h.kind = "pothole";
    return h;
  }

  private static List<Long> fullCoverage() {
    return Arrays.asList(START - 500L, START, START + 500L, START + 1500L,
        START + 2000L, START + 2500L);
  }

  private static List<MotionDetector.Hazard> clearPasses(
      List<MotionDetector.Fix> route, List<MotionDetector.Impact> impacts) {
    return clearPasses(route, impacts, fullCoverage());
  }

  private static List<MotionDetector.Hazard> clearPasses(
      List<MotionDetector.Fix> route, List<MotionDetector.Impact> impacts,
      List<Long> coverage) {
    return MotionDetector.passedHazards(route,
        Collections.singletonList(knownHazard()), impacts, coverage);
  }

  @Test public void confirmedMovingPassProducesNegativeEvidence() {
    assertEquals(1, clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 6, 9.0, true),
        movingFix(2000, 0.00007, 6, 9.0, true)), Collections.emptyList()).size());
  }

  @Test public void singleFixDoesNotPretendRoadIsClear() {
    assertTrue(clearPasses(Collections.singletonList(
        movingFix(0, 0, 5, 10, true)), Collections.emptyList()).isEmpty());
  }

  @Test public void parkedPhoneCannotEraseKnownHazard() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00005, 5, 0, true),
        movingFix(2000, 0.00005, 5, 0, true)), Collections.emptyList()).isEmpty());
  }

  @Test public void locationJitterWithoutActualProgressIsNotAFullPass() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, 0, 5, 9, true),
        movingFix(2000, 0, 5, 9, true)), Collections.emptyList()).isEmpty());
  }

  @Test public void inaccurateOrSpeedlessGpsDoesNotClearRoad() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 80, 9, true),
        movingFix(2000, 0.00007, 80, 9, true)), Collections.emptyList()).isEmpty());
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, false),
        movingFix(2000, 0.00007, 5, 9, false)), Collections.emptyList()).isEmpty());
  }

  @Test public void implausibleGpsAndLargeTimeGapsDoNotClearRoad() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 100, true),
        movingFix(2000, 0.00007, 5, 100, true)), Collections.emptyList()).isEmpty());
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, true),
        movingFix(90_000, 0.00007, 5, 9, true)), Collections.emptyList()).isEmpty());
  }

  @Test public void missingMotionCoverageCannotClaimRoadWasRepaired() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, true),
        movingFix(2000, 0.00007, 5, 9, true)),
        Collections.emptyList(), Collections.emptyList()).isEmpty());
  }

  @Test public void motionSamplesOnlyAtStartAreNotEnough() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, true),
        movingFix(2000, 0.00007, 5, 9, true)),
        Collections.emptyList(),
        Arrays.asList(START - 1000L, START - 500L, START, START + 50L)).isEmpty());
  }

  @Test public void motionSamplesOnlyAtEndAreNotEnough() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, true),
        movingFix(2000, 0.00007, 5, 9, true)),
        Collections.emptyList(),
        Arrays.asList(START + 1700L, START + 2200L, START + 2700L)).isEmpty());
  }

  @Test public void closelyDuplicatedSensorTimestampsAreNotCoverage() {
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, true),
        movingFix(2000, 0.00007, 5, 9, true)),
        Collections.emptyList(),
        Arrays.asList(START, START + 5L, START + 2000L, START + 2005L)).isEmpty());
  }

  @Test public void feltImpactOverridesOtherwiseClearPass() {
    MotionDetector.Impact impact = new MotionDetector.Impact();
    impact.lat = 27.7172;
    impact.lng = 85.324;
    assertTrue(clearPasses(Arrays.asList(
        movingFix(0, -0.00007, 5, 9, true),
        movingFix(2000, 0.00007, 5, 9, true)),
        Collections.singletonList(impact)).isEmpty());
  }
}

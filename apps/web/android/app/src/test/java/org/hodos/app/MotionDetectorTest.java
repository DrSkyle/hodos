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

  private static List<MotionDetector.Sample> buildGoldenSamples(int kind, long durationMs) {
    List<MotionDetector.Sample> out = new ArrayList<>();
    for (long t = 0; t <= durationMs; t += 10) {
      double v = 0;
      if (kind == 0) {
        v = 8.0 * Math.exp(-((t - 1000.0) * (t - 1000.0)) / (2.0 * 20.0 * 20.0));
      } else if (kind == 1) {
        if (t >= 1000 && t <= 1400) {
          v = 8.0 * 0.5 * (1.0 - Math.cos((2.0 * Math.PI * (t - 1000.0)) / 400.0));
        }
      } else if (kind == 2) {
        if (t >= 1000 && t <= 1400) {
          v = 9.0 * Math.sin((2.0 * Math.PI * 5.0 * (t - 1000.0)) / 1000.0)
                  * Math.sin((Math.PI * (t - 1000.0)) / 400.0);
        }
      } else if (kind == 3) {
        v = 2.6 * Math.exp(-((t - 1000.0) * (t - 1000.0)) / (2.0 * 20.0 * 20.0));
      }
      out.add(new MotionDetector.Sample(t, 0, 0, 9.81 + v));
    }
    return out;
  }

  private static List<MotionDetector.Fix> buildGoldenFixes(long durationMs, double speedKph) {
    List<MotionDetector.Fix> out = new ArrayList<>();
    for (long t = 0; t <= durationMs; t += 250) {
      out.add(new MotionDetector.Fix(t, 27.7172, 85.324, 8.0, speedKph / 3.6, true));
    }
    return out;
  }

  @Test public void goldenParityMatchesSharedCore() {
    List<MotionDetector.Impact> pothole = MotionDetector.detect(buildGoldenSamples(0, 2000), buildGoldenFixes(2000, 36));
    assertEquals(1, pothole.size());
    assertEquals(1020L, pothole.get(0).t);
    assertEquals("pothole", pothole.get(0).kind);
    assertEquals("vehicle", pothole.get(0).mode);
    assertEquals(2, pothole.get(0).severity);
    assertEquals(7.531, pothole.get(0).magnitude, 0.001);
    assertEquals(7.32, pothole.get(0).normalised, 0.01);
    assertEquals(0.846, pothole.get(0).confidence, 0.001);
    assertEquals(20.0, pothole.get(0).features.riseMs, 0.001);
    assertEquals(40.0, pothole.get(0).features.widthMs, 0.001);
    assertEquals(1, pothole.get(0).features.lobes);
    assertEquals(229.3, pothole.get(0).features.jerk, 0.1);

    List<MotionDetector.Impact> bump = MotionDetector.detect(buildGoldenSamples(1, 2000), buildGoldenFixes(2000, 36));
    assertEquals(1, bump.size());
    assertEquals(1190L, bump.get(0).t);
    assertEquals("speed_bump", bump.get(0).kind);
    assertEquals(2, bump.get(0).severity);
    assertEquals(6.579, bump.get(0).magnitude, 0.001);
    assertEquals(6.40, bump.get(0).normalised, 0.01);
    assertEquals(0.938, bump.get(0).confidence, 0.001);
    assertEquals(90.0, bump.get(0).features.riseMs, 0.001);
    assertEquals(170.0, bump.get(0).features.widthMs, 0.001);

    List<MotionDetector.Impact> rough = MotionDetector.detect(buildGoldenSamples(2, 2000), buildGoldenFixes(2000, 36));
    assertEquals(1, rough.size());
    assertEquals(1080L, rough.get(0).t);
    assertEquals("rough_pavement", rough.get(0).kind);
    assertEquals(2, rough.get(0).severity);
    assertEquals(8.261, rough.get(0).magnitude, 0.001);
    assertEquals(8.03, rough.get(0).normalised, 0.01);
    assertEquals(0.862, rough.get(0).confidence, 0.001);
    assertEquals(3, rough.get(0).features.lobes);

    List<MotionDetector.Impact> ped = MotionDetector.detect(buildGoldenSamples(3, 2000), buildGoldenFixes(2000, 5));
    assertEquals(1, ped.size());
    assertEquals(1020L, ped.get(0).t);
    assertEquals("pothole", ped.get(0).kind);
    assertEquals("pedestrian", ped.get(0).mode);
    assertEquals(1, ped.get(0).severity);
    assertEquals(2.448, ped.get(0).magnitude, 0.001);
    assertEquals(4.08, ped.get(0).normalised, 0.01);
    assertEquals(0.846, ped.get(0).confidence, 0.001);
  }

  @Test public void monotonicSensorTimestampResolvesDeterministically() {
    long baseNs = 500_000_000_000L;
    long baseEpochMs = 1_700_000_000_000L;
    long sampleNs = baseNs + 20_000_000L; // +20ms
    assertEquals(1_700_000_000_020L,
        HodosService.resolveSensorTimestampMs(sampleNs, 1_700_000_000_999L, baseNs, baseEpochMs));
    // Fallback to wall clock if eventTimestampNs <= 0
    assertEquals(1_700_000_000_999L,
        HodosService.resolveSensorTimestampMs(0L, 1_700_000_000_999L, baseNs, baseEpochMs));
  }
}

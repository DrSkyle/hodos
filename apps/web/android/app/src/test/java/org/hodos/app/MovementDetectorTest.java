package org.hodos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class MovementDetectorTest {

  private static final long NOW = 1_700_000_000_000L;

  private static List<MovementDetector.Accel> vibration(
      long end, long durationMs, double amplitude, double hz) {
    List<MovementDetector.Accel> samples = new ArrayList<>();
    long start = end - durationMs;
    for (long t = start; t <= end; t += 20) {
      double phase = 2 * Math.PI * hz * (t - start) / 1000.0;
      samples.add(new MovementDetector.Accel(
          t,
          amplitude * Math.sin(phase),
          amplitude * Math.cos(phase * 0.7),
          9.81 + amplitude * Math.sin(phase)));
    }
    return samples;
  }

  @Test
  public void stillPhoneDoesNotStartAJourney() {
    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.01, 8), new ArrayList<>(), 0, NOW);

    assertFalse(decision.moving);
    assertEquals("still", decision.reason);
  }

  @Test
  public void sustainedVehicleVibrationStartsWithoutGps() {
    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.45, 8), new ArrayList<>(), 0, NOW);

    assertTrue(decision.moving);
    assertEquals("vibration", decision.reason);
    assertTrue(decision.vibrationSeconds >= 6.0);
  }

  @Test
  public void shortJoltIsNotAJourney() {
    // 1.5 s of impact inside an otherwise still window.
    List<MovementDetector.Accel> samples = vibration(NOW, 10_000, 0.01, 8);
    samples.addAll(vibration(NOW, 1_500, 1.2, 12));

    MovementDetector.Decision decision =
        MovementDetector.evaluate(samples, new ArrayList<>(), 0, NOW);

    assertFalse(decision.moving);
  }

  @Test
  public void walkingStepsVetoAVibrationStart() {
    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.45, 8), new ArrayList<>(), NOW - 1_000, NOW);

    assertFalse(decision.moving);
    assertTrue(decision.walkingVeto);
    assertEquals("walking", decision.reason);
  }

  @Test
  public void gpsDisplacementStartsEvenWithQuietAccelerometer() {
    List<MovementDetector.Fix> fixes = new ArrayList<>();
    fixes.add(new MovementDetector.Fix(NOW - 10_000, 51.5000, -0.1200, 0, true, 8));
    fixes.add(new MovementDetector.Fix(NOW, 51.5010, -0.1200, 0, false, 8));

    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.01, 8), fixes, 0, NOW);

    assertTrue(decision.moving);
    assertEquals("gps", decision.reason);
    assertTrue(decision.displacementSpeedMps > 1.6);
  }

  @Test
  public void singleGpsJumpIsRejected() {
    List<MovementDetector.Fix> fixes = new ArrayList<>();
    fixes.add(new MovementDetector.Fix(NOW - 1_000, 51.5000, -0.1200, 0, false, 8));
    fixes.add(new MovementDetector.Fix(NOW, 51.5018, -0.1200, 0, false, 8));

    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.01, 8), fixes, 0, NOW);

    assertFalse(decision.moving);
  }

  @Test
  public void inaccurateFixesAreIgnored() {
    List<MovementDetector.Fix> fixes = new ArrayList<>();
    fixes.add(new MovementDetector.Fix(NOW - 10_000, 51.5000, -0.1200, 0, false, 400));
    fixes.add(new MovementDetector.Fix(NOW, 51.5010, -0.1200, 0, false, 400));

    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.01, 8), fixes, 0, NOW);

    assertFalse(decision.moving);
  }

  @Test
  public void vibrationWithStationaryGpsIsNotConfirmed() {
    List<MovementDetector.Fix> fixes = new ArrayList<>();
    fixes.add(new MovementDetector.Fix(NOW - 10_000, 51.5000, -0.1200, 0, false, 6));
    fixes.add(new MovementDetector.Fix(NOW, 51.5000, -0.1200, 0, false, 6));

    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.45, 8), fixes, 0, NOW);

    assertFalse(decision.moving);
    assertEquals("vibration-unconfirmed", decision.reason);
  }

  @Test
  public void vibrationAndGpsAgree() {
    List<MovementDetector.Fix> fixes = new ArrayList<>();
    fixes.add(new MovementDetector.Fix(NOW - 10_000, 51.5000, -0.1200, 0, false, 6));
    fixes.add(new MovementDetector.Fix(NOW, 51.5012, -0.1200, 0, false, 6));

    MovementDetector.Decision decision = MovementDetector.evaluate(
        vibration(NOW, 10_000, 0.45, 8), fixes, 0, NOW);

    assertTrue(decision.moving);
    assertEquals("vibration+gps", decision.reason);
    assertTrue(decision.confidence >= 0.9);
  }
}

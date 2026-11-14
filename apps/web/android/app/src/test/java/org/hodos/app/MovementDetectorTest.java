package org.hodos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import org.junit.BeforeClass;
import org.junit.Test;

/**
 * Journey-onset behaviour.
 *
 * These cases used to be built from a pure sinusoid, which the fused estimator
 * correctly reads as a gait cadence rather than an engine: a phone vibrating at
 * 8 Hz with no GPS is *walking*, not driving. That is the whole point of the
 * upgrade, so the fixtures now come from the shared simulator via the committed
 * parity files instead of hand-built signals.
 *
 * The hard rules under test:
 *  - vibration alone never starts a journey,
 *  - GPS alone never starts a journey,
 *  - no GPS never starts a journey,
 *  - walking (the bathroom case) never starts one,
 *  - handling (phone in hand) never starts one,
 *  - a real car/bicycle does.
 */
public class MovementDetectorTest {

  private static Path root;

  @BeforeClass
  public static void locateFixtures() {
    Path dir = Paths.get(System.getProperty("user.dir", ".")).toAbsolutePath();
    for (int i = 0; i < 8 && dir != null; i += 1) {
      Path direct = dir.resolve("fixtures");
      if (Files.isDirectory(direct.resolve("car-pothole"))) {
        root = direct;
        return;
      }
      Path nested = dir.resolve("packages/core/fixtures");
      if (Files.isDirectory(nested.resolve("car-pothole"))) {
        root = nested;
        return;
      }
      dir = dir.getParent();
    }
    root = Paths.get("fixtures");
  }

  private static List<String[]> readCsv(Path path) throws IOException {
    List<String[]> rows = new ArrayList<>();
    try (BufferedReader reader = Files.newBufferedReader(path)) {
      String line;
      boolean header = true;
      while ((line = reader.readLine()) != null) {
        if (line.isBlank()) {
          continue;
        }
        if (header) {
          header = false;
          continue;
        }
        rows.add(line.split(",", -1));
      }
    }
    return rows;
  }

  private static double num(String value) {
    return value == null || value.isEmpty() ? Double.NaN : Double.parseDouble(value);
  }

  private static List<MotionDetector.Sample> samples(String scenario) throws IOException {
    List<MotionDetector.Sample> out = new ArrayList<>();
    for (String[] row : readCsv(root.resolve(scenario).resolve("samples.csv"))) {
      long t = Long.parseLong(row[0]);
      if (row.length >= 7 && !row[4].isEmpty()) {
        out.add(new MotionDetector.Sample(
            t, num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]), num(row[6])));
      } else {
        out.add(new MotionDetector.Sample(t, num(row[1]), num(row[2]), num(row[3])));
      }
    }
    return out;
  }

  private static List<MotionDetector.Fix> fixes(String scenario) throws IOException {
    List<MotionDetector.Fix> out = new ArrayList<>();
    for (String[] row : readCsv(root.resolve(scenario).resolve("fixes.csv"))) {
      double speed = num(row[4]);
      out.add(new MotionDetector.Fix(
          Long.parseLong(row[0]), num(row[1]), num(row[2]), num(row[3]),
          Double.isNaN(speed) ? 0 : speed, !Double.isNaN(speed)));
    }
    return out;
  }

  private static List<MovementDetector.Accel> asAccel(List<MotionDetector.Sample> samples) {
    List<MovementDetector.Accel> out = new ArrayList<>(samples.size());
    for (MotionDetector.Sample s : samples) {
      out.add(new MovementDetector.Accel(s.t, s.ax, s.ay, s.az));
    }
    return out;
  }

  private static List<MovementDetector.Fix> asFix(List<MotionDetector.Fix> fixes) {
    List<MovementDetector.Fix> out = new ArrayList<>(fixes.size());
    for (MotionDetector.Fix f : fixes) {
      out.add(new MovementDetector.Fix(f.t, f.lat, f.lng, f.speed, f.hasSpeed, f.accuracy));
    }
    return out;
  }

  private static MovementDetector.Decision evaluate(
      String scenario, long stepAtMs) throws IOException {
    List<MotionDetector.Sample> samples = samples(scenario);
    List<MotionDetector.Fix> fixes = fixes(scenario);
    long now = samples.get(samples.size() - 1).t;
    return MovementDetector.evaluate(asAccel(samples), asFix(fixes), stepAtMs <= 0 ? 0 : now - 1_000, now);
  }

  @Test
  public void aWalkingPhoneDoesNotStartAJourney() throws IOException {
    // The bathroom case: phone in a pocket, footfalls, no GPS.
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("bathroom-walk")));
    MovementDetector.Decision decision = evaluate("bathroom-walk", 0);
    assertFalse(decision.moving);
    assertEquals(MotionStateEstimator.WALKING, decision.state);
  }

  @Test
  public void aPhoneInHandDoesNotStartAJourney() throws IOException {
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("handling")));
    MovementDetector.Decision decision = evaluate("handling", 0);
    assertFalse(decision.moving);
    assertEquals(MotionStateEstimator.IN_HAND, decision.state);
  }

  @Test
  public void aRealCarStartsAJourney() throws IOException {
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("car-pothole")));
    MovementDetector.Decision decision = evaluate("car-pothole", 0);
    assertEquals(MotionStateEstimator.VEHICLE, decision.state);
    assertTrue("a moving car must start a journey", decision.moving);
    assertTrue(decision.reason.startsWith("fused:"));
  }

  @Test
  public void aBicycleStartsAJourney() throws IOException {
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("bicycle-rut")));
    MovementDetector.Decision decision = evaluate("bicycle-rut", 0);
    assertEquals(MotionStateEstimator.CYCLING, decision.state);
    assertTrue(decision.moving);
  }

  @Test
  public void aBusWithShudderStillStartsAJourney() throws IOException {
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("bus-shudder")));
    MovementDetector.Decision decision = evaluate("bus-shudder", 0);
    assertEquals(MotionStateEstimator.VEHICLE, decision.state);
    assertTrue(decision.moving);
  }

  @Test
  public void sustainedVibrationWithNoGpsNeverStartsAJourney() throws IOException {
    // The old pipeline started a journey here at 0.6 confidence. Vibration
    // alone cannot tell a moving vehicle from a phone handled indoors.
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("bathroom-walk")));
    List<MotionDetector.Sample> samples = samples("bathroom-walk");
    long now = samples.get(samples.size() - 1).t;
    MovementDetector.Decision decision =
        MovementDetector.evaluate(asAccel(samples), new ArrayList<>(), 0, now);
    assertFalse(decision.moving);
  }

  @Test
  public void gpsAloneNeverStartsAJourney() {
    // Two fixes 400 m apart with a dead accelerometer: no body evidence.
    List<MovementDetector.Fix> fixes = new ArrayList<>();
    fixes.add(new MovementDetector.Fix(NOW - 10_000, 51.5000, -0.1200, 12, true, 8));
    fixes.add(new MovementDetector.Fix(NOW - 2_000, 51.5036, -0.1200, 12, true, 8));
    fixes.add(new MovementDetector.Fix(NOW, 51.5040, -0.1200, 12, true, 8));

    MovementDetector.Decision decision =
        MovementDetector.evaluate(new ArrayList<>(), fixes, 0, NOW);

    assertFalse(decision.moving);
  }

  @Test
  public void aWalkingStepVetoesEvenAFusedVehicleWindow() throws IOException {
    assertTrue("fixtures missing; run gen:fixtures", Files.isDirectory(root.resolve("car-pothole")));
    MovementDetector.Decision decision = evaluate("car-pothole", 1);
    assertFalse(decision.moving);
    assertTrue(decision.walkingVeto);
    assertEquals("walking", decision.reason);
  }

  @Test
  public void theDecisionExposesTheEvidenceItUsed() throws IOException {
    MovementDetector.Decision decision = evaluate("car-pothole", 0);
    assertNotNull(decision.state);
    assertTrue(decision.vibrationSeconds > 0);
    assertTrue(decision.motionRms > 0);
  }

  private static final long NOW = 1_700_000_000_000L;
}

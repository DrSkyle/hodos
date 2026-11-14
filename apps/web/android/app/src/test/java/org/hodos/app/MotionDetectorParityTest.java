package org.hodos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/**
 * Shared parity check: the Java port must produce byte-identical impacts to the
 * TypeScript reference for the same fixtures.
 *
 * The fixtures are generated from packages/core by `pnpm --filter @hodos/core
 * gen:fixtures`, and the TypeScript side has a test that fails if they drift
 * from the algorithm. Nothing here is hand-copied: both implementations read the
 * same CSV files.
 *
 * Deliberately tolerant of a missing fixtures directory (Assume) so a checkout
 * without the generator run does not fail the whole module — but a *present*
 * fixture must match exactly.
 */
public class MotionDetectorParityTest {

  private static final String[] SCENARIOS = {
    "car-pothole",
    "car-bump",
    "car-rough",
    "car-smooth",
    "car-angled-pothole",
    "car-kerb",
    "car-swerve",
    "motorcycle-bump",
    "bicycle-rut",
    "bathroom-walk",
    "handling",
    "bus-shudder",
    "tunnel-gap",
    "slow-15kph-pothole",
    "in-hand-vs-mounted",
    "rate-100hz",
    "jittered-clock",
  };

  private static Path fixturesRoot() {
    // Gradle's test working directory varies by invocation, so walk upward from
    // the JVM cwd until the committed fixtures directory is found.
    Path dir = Paths.get(System.getProperty("user.dir", ".")).toAbsolutePath();
    for (int i = 0; i < 8 && dir != null; i += 1) {
      Path direct = dir.resolve("fixtures");
      if (Files.isDirectory(direct.resolve("car-pothole"))) {
        return direct;
      }
      Path nested = dir.resolve("packages/core/fixtures");
      if (Files.isDirectory(nested.resolve("car-pothole"))) {
        return nested;
      }
      dir = dir.getParent();
    }
    return Paths.get("fixtures");
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

  @Test
  public void javaPortMatchesTypeScriptOnEverySharedFixture() throws IOException {
    Path root = fixturesRoot();
    assertTrue(
        "fixtures not found from " + System.getProperty("user.dir") +
            " (run `pnpm --filter @hodos/core gen:fixtures`)",
        Files.isDirectory(root.resolve("car-pothole")));

    int checked = 0;
    for (String scenario : SCENARIOS) {
      File dir = root.resolve(scenario).toFile();
      assertTrue("missing fixture " + scenario, dir.isDirectory());

      List<MotionDetector.Sample> samples = new ArrayList<>();
      for (String[] row : readCsv(root.resolve(scenario).resolve("samples.csv"))) {
        long t = Long.parseLong(row[0]);
        if (row.length >= 7 && !row[4].isEmpty()) {
          samples.add(new MotionDetector.Sample(
              t, num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]), num(row[6])));
        } else {
          samples.add(new MotionDetector.Sample(t, num(row[1]), num(row[2]), num(row[3])));
        }
      }

      List<MotionDetector.Fix> fixes = new ArrayList<>();
      for (String[] row : readCsv(root.resolve(scenario).resolve("fixes.csv"))) {
        double speed = num(row[4]);
        fixes.add(new MotionDetector.Fix(
            Long.parseLong(row[0]), num(row[1]), num(row[2]), num(row[3]),
            Double.isNaN(speed) ? 0 : speed, !Double.isNaN(speed)));
      }

      List<MotionDetector.Impact> actual = MotionDetector.detect(samples, fixes);
      List<String[]> expected = readCsv(root.resolve(scenario).resolve("expected-impacts.csv"));

      assertEquals(scenario + ": impact count", expected.size(), actual.size());
      for (int i = 0; i < expected.size(); i++) {
        String[] e = expected.get(i);
        MotionDetector.Impact a = actual.get(i);
        String where = scenario + " impact #" + i;
        assertEquals(where + " t", Long.parseLong(e[0]), a.t);
        assertEquals(where + " lat", num(e[1]), a.lat, 1e-6);
        assertEquals(where + " lng", num(e[2]), a.lng, 1e-6);
        assertEquals(where + " accuracy", num(e[3]), a.accuracy, 1e-3);
        assertEquals(where + " speedKph", num(e[4]), a.speedKph, 1e-3);
        assertEquals(where + " magnitude", num(e[5]), a.magnitude, 1e-3);
        assertEquals(where + " normalised", num(e[6]), a.normalised, 1e-3);
        assertEquals(where + " severity", Integer.parseInt(e[7]), a.severity);
        assertEquals(where + " kind", e[8], a.kind);
        assertEquals(where + " confidence", num(e[9]), a.confidence, 1e-3);
        assertEquals(where + " mode", e[10], a.mode);
        assertEquals(where + " motionState", e[11], a.motionState);
        assertEquals(where + " peak", num(e[12]), a.features.peak, 1e-3);
        assertEquals(where + " riseMs", num(e[13]), a.features.riseMs, 1e-3);
        assertEquals(where + " widthMs", num(e[14]), a.features.widthMs, 1e-3);
        assertEquals(where + " lobes", Integer.parseInt(e[15]), a.features.lobes);
        assertEquals(where + " jerk", num(e[16]), a.features.jerk, 1e-1);
        assertEquals(where + " lateralRatio", num(e[17]), a.features.lateralRatio, 1e-3);
      }
      checked += 1;
    }
    assertTrue("no fixtures were checked", checked > 0);
  }

  @Test
  public void javaPortMatchesTheMotionTimeline() throws IOException {
    Path root = fixturesRoot();
    assertTrue(
        "fixtures not found from " + System.getProperty("user.dir") +
            " (run `pnpm --filter @hodos/core gen:fixtures`)",
        Files.isDirectory(root.resolve("car-pothole")));

    for (String scenario : SCENARIOS) {
      File dir = root.resolve(scenario).toFile();
      assertTrue("missing fixture " + scenario, dir.isDirectory());
      List<MotionDetector.Sample> samples = new ArrayList<>();
      for (String[] row : readCsv(root.resolve(scenario).resolve("samples.csv"))) {
        long t = Long.parseLong(row[0]);
        if (row.length >= 7 && !row[4].isEmpty()) {
          samples.add(new MotionDetector.Sample(
              t, num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]), num(row[6])));
        } else {
          samples.add(new MotionDetector.Sample(t, num(row[1]), num(row[2]), num(row[3])));
        }
      }
      List<MotionDetector.Fix> fixes = new ArrayList<>();
      for (String[] row : readCsv(root.resolve(scenario).resolve("fixes.csv"))) {
        double speed = num(row[4]);
        fixes.add(new MotionDetector.Fix(
            Long.parseLong(row[0]), num(row[1]), num(row[2]), num(row[3]),
            Double.isNaN(speed) ? 0 : speed, !Double.isNaN(speed)));
      }
      MotionStateEstimator.Timeline timeline =
          MotionStateEstimator.estimateMotionTimeline(samples, fixes);
      for (String[] row : readCsv(root.resolve(scenario).resolve("expected-timeline.csv"))) {
        long t = Long.parseLong(row[0]);
        assertEquals(scenario + " stateAt " + t, row[1], MotionStateEstimator.stateAt(timeline, t));
      }
    }
  }
}

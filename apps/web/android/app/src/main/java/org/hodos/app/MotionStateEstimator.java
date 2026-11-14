package org.hodos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.TreeMap;

/**
 * Native port of packages/core/src/motion-state.ts.
 *
 * Motion-state estimation by evidence fusion. No single signal decides anything.
 * Each analysis window yields independent observations —
 *   1. motion energy       (robust per-second RMS of linear acceleration)
 *   2. gait / pedal cadence (autocorrelation of acceleration magnitude,
 *                            orientation independent, no platform step sensor)
 *   3. grip stability      (how much the gravity vector wanders, plus gyro)
 *   4. engine-band energy  (high-frequency vibration a running engine adds)
 *   5. GPS speed and displacement (and whether the two agree)
 * - and a state is only returned when the observations that define it agree.
 * Anything ambiguous or contradictory is "unknown", which can never emit.
 *
 * Parity rules: Math.sqrt only (never Math.hypot), StrictMath for sin/cos, and
 * identical operation order, because the goldens are exact-value assertions.
 */
public final class MotionStateEstimator {

  public static final String STILL = "still";
  public static final String WALKING = "walking";
  public static final String CYCLING = "cycling";
  public static final String IN_HAND = "in_hand";
  public static final String VEHICLE = "vehicle";
  public static final String UNKNOWN = "unknown";

  /** Fraction of an entry threshold that is enough to stay in the state you are already in. */
  public static final double HOLD_FACTOR = 0.65;

  public static final class Options {
    public long windowMs = 6000;
    public long hopMs = 1000;
    public int dwellHops = 2;
    public int minSamples = 40;
    public double minSpanFraction = 0.6;
    public double resampleHz = 50;
    public double stepMinHz = 1.4;
    public double stepMaxHz = 2.8;
    public double pedalMinHz = 0.7;
    public double pedalMaxHz = 1.6;
    public double stepCorr = 0.55;
    public double pedalCorr = 0.3;
    public double walkMinRms = 0.5;
    public double stillMaxRms = 0.15;
    public double vehicleMinRms = 0.1;
    public double engineHfRms = 0.12;
    public double handDriftDeg = 12;
    public double handGyroDps = 25;
    public double walkMaxKph = 9;
    public double minMovingKph = 5;
    public double cyclingMaxKph = 32;
    public int minGpsFixes = 3;
    public double maxFixAccuracyM = 50;
  }

  public static final Options DEFAULTS = new Options();

  public static final class Evidence {
    public int samples;
    public long spanMs;
    public double motionRms;
    public double hfRms;
    public double stepCorr;
    public double stepHz;
    public double pedalCorr;
    public double pedalHz;
    public double gravityDriftDeg;
    /** NaN when the device reports no gyroscope. */
    public double gyroRms = Double.NaN;
    /** NaN when there is no usable speed evidence. */
    public double gpsKph = Double.NaN;
    public int gpsFixes;
    public boolean gpsConflict;

    public boolean hasGyro() {
      return !Double.isNaN(gyroRms);
    }

    public boolean hasGps() {
      return !Double.isNaN(gpsKph);
    }
  }

  public static final class Span {
    public long t;
    public String raw;
    public String state;
    public Evidence evidence;
  }

  public static final class Timeline {
    public long startT;
    public long hopMs;
    public List<Span> spans = new ArrayList<>();
  }

  public static final class JourneyDecision {
    public boolean moving;
    public String state;
    public double confidence;
    public String reason;
    public Evidence evidence;
  }

  private MotionStateEstimator() {}

  public static boolean emitsImpacts(String state) {
    return WALKING.equals(state) || CYCLING.equals(state) || VEHICLE.equals(state);
  }

  /** Angle between two vectors, in degrees, from the chord between their unit vectors. */
  private static double angleDeg(double[] a, double[] b) {
    double na = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    double nb = Math.sqrt(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]);
    if (na < 1e-9 || nb < 1e-9) {
      return 0;
    }
    double dx = a[0] / na - b[0] / nb;
    double dy = a[1] / na - b[1] / nb;
    double dz = a[2] / na - b[2] / nb;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) * (180 / Math.PI);
  }

  private static final class GpsEvidence {
    double kph = Double.NaN;
    int count;
    boolean conflict;
  }

  private static GpsEvidence gpsEvidence(
      List<MotionDetector.Fix> fixes, long from, long to, double maxAccuracyM) {
    List<MotionDetector.Fix> valid = new ArrayList<>();
    for (MotionDetector.Fix fix : fixes) {
      if (fix.t < from || fix.t > to) {
        continue;
      }
      if (!Placement.isFinite(fix.lat) || !Placement.isFinite(fix.lng) ||
          Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 ||
          !Placement.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > maxAccuracyM) {
        continue;
      }
      valid.add(fix);
    }
    GpsEvidence out = new GpsEvidence();
    out.count = valid.size();
    if (valid.isEmpty()) {
      return out;
    }
    List<Double> speeds = new ArrayList<>();
    for (MotionDetector.Fix fix : valid) {
      if (fix.hasSpeed && Placement.isFinite(fix.speed) && fix.speed >= 0 && fix.speed <= 70) {
        speeds.add(fix.speed * 3.6);
      }
    }
    Double reported = speeds.size() >= 2 ? Signals.median(speeds) : null;

    Double displacement = null;
    MotionDetector.Fix first = valid.get(0);
    MotionDetector.Fix last = valid.get(valid.size() - 1);
    double elapsed = (last.t - first.t) / 1000.0;
    if (valid.size() >= 2 && elapsed >= 3) {
      double distance = Placement.haversine(first, last);
      if (distance <= elapsed * 45 + 30) {
        displacement = (distance / elapsed) * 3.6;
      }
    }

    if (reported != null && displacement != null) {
      out.conflict = Math.abs(reported - displacement) >
          Math.max(4, 0.5 * Math.max(reported, displacement));
    }
    Double kph = reported != null ? reported : displacement;
    if (kph != null) {
      out.kph = kph;
    }
    return out;
  }

  /** Observations for the window [from, to]. `samples` must be time-ordered. */
  public static Evidence computeEvidence(
      List<MotionDetector.Sample> samples,
      List<MotionDetector.Fix> fixes,
      long from,
      long to) {
    return computeEvidence(samples, fixes, from, to, DEFAULTS);
  }

  public static Evidence computeEvidence(
      List<MotionDetector.Sample> samples,
      List<MotionDetector.Fix> fixes,
      long from,
      long to,
      Options o) {
    List<MotionDetector.Sample> win = new ArrayList<>();
    for (MotionDetector.Sample s : samples) {
      if (s.t >= from && s.t <= to) {
        win.add(s);
      }
    }
    GpsEvidence gps = gpsEvidence(fixes, from, to, o.maxFixAccuracyM);
    Evidence empty = new Evidence();
    empty.samples = win.size();
    empty.gpsKph = gps.kph;
    empty.gpsFixes = gps.count;
    empty.gpsConflict = gps.conflict;
    if (win.size() < 2) {
      return empty;
    }
    long t0 = win.get(0).t;
    long spanMs = win.get(win.size() - 1).t - t0;
    empty.spanMs = spanMs;

    TreeMap<Long, Block> blocks = new TreeMap<>();
    for (MotionDetector.Sample s : win) {
      long key = floorDiv(s.t - t0, 1000);
      Block b = blocks.get(key);
      if (b == null) {
        b = new Block();
        blocks.put(key, b);
      }
      b.n += 1;
      b.sx += s.ax;
      b.sy += s.ay;
      b.sz += s.az;
      b.items.add(s);
    }
    List<Double> blockRms = new ArrayList<>();
    List<Double> blockGyro = new ArrayList<>();
    List<Double> blockHf = new ArrayList<>();
    List<double[]> means = new ArrayList<>();
    boolean hasGyro = false;
    for (Block b : blocks.values()) {
      if (b.n < 5) {
        continue;
      }
      double mx = b.sx / b.n;
      double my = b.sy / b.n;
      double mz = b.sz / b.n;
      double ss = 0;
      double gs = 0;
      int gn = 0;
      for (MotionDetector.Sample s : b.items) {
        double dx = s.ax - mx;
        double dy = s.ay - my;
        double dz = s.az - mz;
        ss += dx * dx + dy * dy + dz * dz;
        if (s.hasGyro) {
          gs += s.gx * s.gx + s.gy * s.gy + s.gz * s.gz;
          gn += 1;
        }
      }
      blockRms.add(Math.sqrt(ss / b.n));
      double hs = 0;
      for (int q = 1; q < b.items.size(); q += 1) {
        MotionDetector.Sample m1 = b.items.get(q);
        MotionDetector.Sample m0 = b.items.get(q - 1);
        double d =
            Math.sqrt(m1.ax * m1.ax + m1.ay * m1.ay + m1.az * m1.az) -
            Math.sqrt(m0.ax * m0.ax + m0.ay * m0.ay + m0.az * m0.az);
        hs += d * d;
      }
      blockHf.add(Math.sqrt(hs / Math.max(1, b.items.size() - 1) / 2));
      means.add(new double[] {mx, my, mz});
      if (gn > 0) {
        hasGyro = true;
        blockGyro.add(Math.sqrt(gs / gn));
      }
    }
    List<Double> drifts = new ArrayList<>();
    for (int i = 1; i < means.size(); i += 1) {
      drifts.add(angleDeg(means.get(i - 1), means.get(i)));
    }

    List<Long> times = new ArrayList<>();
    List<Double> mag = new ArrayList<>();
    for (MotionDetector.Sample s : win) {
      times.add(s.t);
      mag.add(Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az));
    }
    int count = Math.max(8, (int) Math.floor((spanMs / 1000.0) * o.resampleHz));
    List<Double> uniform = Signals.resampleUniform(times, mag, t0, o.resampleHz, count);
    double mean = 0;
    for (double v : uniform) {
      mean += v;
    }
    mean /= uniform.size();
    List<Double> centred = new ArrayList<>();
    for (double v : uniform) {
      centred.add(v - mean);
    }
    List<Double> abs = new ArrayList<>();
    for (double v : centred) {
      abs.add(Math.abs(v));
    }
    double sigma = 1.4826 * Signals.median(abs);
    double clip = 5 * Math.max(sigma, 0.05);
    List<Double> zero = new ArrayList<>();
    for (double v : centred) {
      zero.add(Math.max(-clip, Math.min(clip, v)));
    }

    int stepLo = (int) Math.round(o.resampleHz / o.stepMaxHz);
    int stepHi = (int) Math.round(o.resampleHz / o.stepMinHz);
    Signals.Autocorr step = Signals.autocorrPeak(zero, stepLo, stepHi);
    int pedalLo = (int) Math.round(o.resampleHz / o.pedalMaxHz);
    int pedalHi = (int) Math.round(o.resampleHz / o.pedalMinHz);
    Signals.Autocorr pedal = Signals.autocorrPeak(zero, pedalLo, pedalHi);

    Evidence ev = new Evidence();
    ev.samples = win.size();
    ev.spanMs = spanMs;
    ev.motionRms = Signals.median(blockRms);
    ev.hfRms = Signals.median(blockHf);
    ev.stepCorr = step.corr;
    ev.stepHz = step.lag > 0 ? o.resampleHz / step.lag : 0;
    ev.pedalCorr = pedal.corr;
    ev.pedalHz = pedal.lag > 0 ? o.resampleHz / pedal.lag : 0;
    ev.gravityDriftDeg = Signals.median(drifts);
    ev.gyroRms = hasGyro ? Signals.median(blockGyro) : Double.NaN;
    ev.gpsKph = gps.kph;
    ev.gpsFixes = gps.count;
    ev.gpsConflict = gps.conflict;
    return ev;
  }

  private static long floorDiv(long a, long b) {
    long q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) {
      q -= 1;
    }
    return q;
  }

  private static final class Block {
    int n;
    double sx;
    double sy;
    double sz;
    final List<MotionDetector.Sample> items = new ArrayList<>();
  }

  /**
   * Decide a state from one window of evidence. Pure and total.
   *
   * `previous` is the stable state so far: the discriminating threshold of that
   * state is relaxed to HOLD_FACTOR, a Schmitt trigger, so marginal evidence
   * cannot make the state chatter while entering it still takes full evidence.
   */
  public static String classifyEvidence(Evidence ev, Options o, String previous) {
    if (ev.samples < o.minSamples || ev.spanMs < o.windowMs * o.minSpanFraction) {
      return UNKNOWN;
    }
    if (ev.gpsConflict) {
      return UNKNOWN;
    }
    boolean hasGps = !Double.isNaN(ev.gpsKph);
    double gps = ev.gpsKph;

    // Gait: periodic body motion with energy, and no contradicting fast GPS.
    boolean gait =
        ev.stepCorr >= o.stepCorr * (WALKING.equals(previous) ? HOLD_FACTOR : 1) &&
            ev.motionRms >= o.walkMinRms;
    if (gait && (!hasGps || gps <= o.walkMaxKph)) {
      return WALKING;
    }

    // Grip: a wandering gravity vector or real rotation = phone is being held/moved.
    boolean handled = ev.gravityDriftDeg >= o.handDriftDeg ||
        (ev.hasGyro() && ev.gyroRms >= o.handGyroDps);
    if (handled) {
      return IN_HAND;
    }

    // Locomotion: GPS motion must be corroborated by body vibration.
    if (hasGps && gps >= o.minMovingKph && ev.gpsFixes >= o.minGpsFixes) {
      if (ev.motionRms < o.vehicleMinRms) {
        return UNKNOWN;
      }
      if (ev.hfRms >= o.engineHfRms * (VEHICLE.equals(previous) ? HOLD_FACTOR : 1)) {
        return VEHICLE;
      }
      if (gps <= o.cyclingMaxKph) {
        return ev.pedalCorr >= o.pedalCorr * (CYCLING.equals(previous) ? HOLD_FACTOR : 1)
            ? CYCLING
            : UNKNOWN;
      }
      return VEHICLE;
    }

    if (ev.motionRms < o.stillMaxRms && (!hasGps || gps < 1.5)) {
      return STILL;
    }
    return UNKNOWN;
  }

  /**
   * State per hop across a recording, with dwell hysteresis: the stable state
   * only changes after `dwellHops` consecutive windows agree.
   */
  public static Timeline estimateMotionTimeline(
      List<MotionDetector.Sample> samples, List<MotionDetector.Fix> fixes) {
    return estimateMotionTimeline(samples, fixes, DEFAULTS);
  }

  public static Timeline estimateMotionTimeline(
      List<MotionDetector.Sample> samples, List<MotionDetector.Fix> fixes, Options o) {
    Timeline timeline = new Timeline();
    timeline.hopMs = o.hopMs;
    if (samples.isEmpty()) {
      return timeline;
    }
    List<MotionDetector.Sample> ordered = new ArrayList<>(samples);
    Collections.sort(ordered, Comparator.comparingLong(s -> s.t));
    List<MotionDetector.Fix> sortedFixes = new ArrayList<>(fixes);
    Collections.sort(sortedFixes, Comparator.comparingLong(f -> f.t));

    long startT = ordered.get(0).t;
    long endT = ordered.get(ordered.size() - 1).t;
    timeline.startT = startT;
    String stable = UNKNOWN;
    String candidate = null;
    int streak = 0;
    for (long c = startT; c <= endT + o.hopMs; c += o.hopMs) {
      Evidence ev = computeEvidence(ordered, sortedFixes, c - o.windowMs / 2, c + o.windowMs / 2, o);
      String raw = classifyEvidence(ev, o, stable);
      if (raw.equals(stable)) {
        candidate = null;
        streak = 0;
      } else if (raw.equals(candidate)) {
        streak += 1;
      } else {
        candidate = raw;
        streak = 1;
      }
      if (candidate != null && streak >= o.dwellHops) {
        stable = candidate;
        candidate = null;
        streak = 0;
      }
      Span span = new Span();
      span.t = c;
      span.raw = raw;
      span.state = stable;
      span.evidence = ev;
      timeline.spans.add(span);
    }
    return timeline;
  }

  public static String stateAt(Timeline timeline, long t) {
    if (timeline.spans.isEmpty()) {
      return UNKNOWN;
    }
    long index = Math.round((double) (t - timeline.startT) / timeline.hopMs);
    if (index < 0 || index >= timeline.spans.size()) {
      return UNKNOWN;
    }
    return timeline.spans.get((int) index).state;
  }

  /**
   * Is a road-recording journey under way right now? The latest window must
   * classify as vehicle or cycling: motion energy, GPS speed/displacement and a
   * stable grip all agree. Never true on vibration alone, GPS alone, or with no GPS.
   */
  public static JourneyDecision decideJourney(
      List<MotionDetector.Sample> samples,
      List<MotionDetector.Fix> fixes,
      long now,
      Options o) {
    List<MotionDetector.Sample> ordered = new ArrayList<>(samples);
    Collections.sort(ordered, Comparator.comparingLong(s -> s.t));
    Evidence ev = computeEvidence(ordered, fixes, now - o.windowMs, now, o);
    String state = classifyEvidence(ev, o, UNKNOWN);
    boolean moving = VEHICLE.equals(state) || CYCLING.equals(state);
    int agreeing = 0;
    if (ev.motionRms >= o.vehicleMinRms) agreeing += 1;
    if (ev.hasGps() && ev.gpsKph >= o.minMovingKph && ev.gpsFixes >= o.minGpsFixes) agreeing += 1;
    if (ev.hfRms >= o.engineHfRms || ev.pedalCorr >= o.pedalCorr) agreeing += 1;
    if (ev.gravityDriftDeg < o.handDriftDeg) agreeing += 1;
    JourneyDecision d = new JourneyDecision();
    d.moving = moving;
    d.state = state;
    d.confidence = moving ? Math.round((agreeing / 4.0) * 1000) / 1000.0 : 0;
    d.reason = (moving ? "fused:" : "not-moving:") + state;
    d.evidence = ev;
    return d;
  }

  public static JourneyDecision decideJourney(
      List<MotionDetector.Sample> samples, List<MotionDetector.Fix> fixes, long now) {
    return decideJourney(samples, fixes, now, DEFAULTS);
  }
}

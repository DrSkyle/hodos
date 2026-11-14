package org.hodos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Native port of the @hodos/core detection pipeline, so detection can run in a
 * background service without a WebView. Keep the constants in step with
 * packages/core: the two implementations are checked against the same fixtures.
 *
 * Pipeline (mirrors packages/core/src/detect.ts):
 *  1. Motion state (MotionStateEstimator): vehicle / cycling / walking only.
 *     still, in_hand and unknown never reach the detector.
 *  2. Vertical residual -> 0.5-6 Hz band-pass, restarted across clock gaps.
 *  3. Rolling MAD noise floor, lower-bounded by the per-journey calibration.
 *  4. Event walk: threshold crossing -> true peak -> release.
 *  5. Placement: a credible interpolated position, or nothing.
 *  6. Features + classify (soft lateral / handling / broadband penalties).
 */
public final class MotionDetector {

  public static final class Sample {
    public long t;
    public double ax;
    public double ay;
    public double az;
    /** Rotation rate, deg/s. `hasGyro` false means the device reports none. */
    public double gx;
    public double gy;
    public double gz;
    public boolean hasGyro;

    public Sample(long t, double ax, double ay, double az) {
      this.t = t;
      this.ax = ax;
      this.ay = ay;
      this.az = az;
    }

    public Sample(long t, double ax, double ay, double az,
                  double gx, double gy, double gz) {
      this(t, ax, ay, az);
      this.gx = gx;
      this.gy = gy;
      this.gz = gz;
      this.hasGyro = true;
    }
  }

  public static final class Fix {
    public long t;
    public double lat;
    public double lng;
    public double accuracy;
    public double speed;
    public boolean hasSpeed;
    /** Sustained vibration energy (g RMS) captured at fix time. -1 = unknown. */
    public double roughness = -1.0;

    public Fix(long t, double lat, double lng, double accuracy, double speed, boolean hasSpeed) {
      this.t = t;
      this.lat = lat;
      this.lng = lng;
      this.accuracy = accuracy;
      this.speed = speed;
      this.hasSpeed = hasSpeed;
    }
  }

  public static final class Features {
    public double peak;
    public double riseMs;
    public double widthMs;
    public int lobes;
    public double jerk;
    public double lateralRatio;
    /** Share of the pulse energy in the road band, 0..1. NaN when not computed. */
    public double roadBandRatio = Double.NaN;
    /** Peak rotation rate around the event, deg/s. NaN when no gyroscope. */
    public double gyroPeakDps = Double.NaN;
    /** Peak yaw rate, deg/s. NaN when no gyroscope. */
    public double yawPeakDps = Double.NaN;
  }

  public static final class Impact {
    public long t;
    public double lat;
    public double lng;
    public double accuracy;
    public double speedKph;
    public double magnitude;
    public double normalised;
    public double confidence;
    public int severity;
    public String kind;
    /** "vehicle", "pedestrian" or "cycling". */
    public String mode;
    public Features features;
    /** Fused motion state the device was in when the impact was felt. */
    public String motionState;
    /** How many earlier separate passes felt the same defect (on-device ledger). */
    public int repeats;
  }

  public static final class Observed {
    public Impact impact;
    public String deviceId;
  }

  public static final class Hazard {
    public String id;
    public double lat;
    public double lng;
    public String kind;
    public int severity;
    public int passCount;
    public int deviceCount;
    public int dayCount;
    public double confidence;
    public long firstSeen;
    public long lastSeen;
    public boolean published;
  }

  /* ---- detect.ts constants (keep in step with packages/core) ---- */

  static final double GRAVITY_ALPHA = 0.02;
  static final double BAND_LOW_HZ = 0.5;
  static final double BAND_HIGH_HZ = 6.0;
  static final double NOISE_WINDOW_MS = 2000;
  static final double DEBOUNCE_MS = 1500;
  static final double MAX_FIX_AGE_MS = 3000;
  static final double MAX_FIX_ACCURACY_M = 50;
  static final double RELEASE_FRACTION = 0.5;
  static final double SPEED_REFERENCE_KPH = 35;
  static final double MODERATE_NORMALISED = 6;
  static final double SEVERE_NORMALISED = 12;
  static final double WALKING_MAX_KPH = 10;
  static final double GAP_RESET_MS = 250;
  static final double LEARN_MS = 20000;
  static final double CALIBRATION_FLOOR_SHARE = 0.8;

  /* classify.ts */
  static final double SHARP_RISE_MS = 60;
  static final double BUMP_MIN_WIDTH_MS = 180;
  static final double JERK_REF = 50;
  static final double MAX_LATERAL_RATIO = 1.4;
  static final double SOFT_LATERAL_RATIO = 0.5;
  static final double LATERAL_PENALTY = 0.3;
  static final double YAW_REJECT_DPS = 35;
  static final double HANDLING_GYRO_DPS = 120;
  static final double MIN_ROAD_BAND_RATIO = 0.35;
  static final double MIN_SCORE = 0.5;

  /* Mode options. Vehicle state is itself the gate, so the speed floor only has
   * to rule out a parked or crawling device. */
  static final class ModeOptions {
    final double absoluteFloor;
    final double noiseK;
    final double minSpeedKph;
    final double maxSpeedKph;

    ModeOptions(double absoluteFloor, double noiseK, double minSpeedKph, double maxSpeedKph) {
      this.absoluteFloor = absoluteFloor;
      this.noiseK = noiseK;
      this.minSpeedKph = minSpeedKph;
      this.maxSpeedKph = maxSpeedKph;
    }
  }

  static final ModeOptions VEHICLE_MODE = new ModeOptions(1.6, 4.0, 5, 220);
  static final ModeOptions PEDESTRIAN_MODE = new ModeOptions(0.9, 4.5, 1, 12);
  static final ModeOptions CYCLING_MODE = new ModeOptions(1.3, 3.5, 5, 55);
  static final int CYCLING_MAX_SEVERITY = 1;
  static final double CYCLING_CONFIDENCE_SCALE = 0.75;

  static final double MERGE_DISTANCE_M = 15;
  static final int PUBLISH_MIN_PASSES = 3;
  static final int PUBLISH_MIN_DEVICES = 2;
  static final double HALF_LIFE_DAYS = 90;

  private MotionDetector() {}

  private static double round3(double v) {
    return Math.round(v * 1000.0) / 1000.0;
  }

  private static double round2(double v) {
    return Math.round(v * 100.0) / 100.0;
  }

  private static double round1(double v) {
    return Math.round(v * 10.0) / 10.0;
  }

  private static double clamp(double value, double low, double high) {
    return Math.min(high, Math.max(low, value));
  }

  /** The band-passed vertical series, plus optional gyro/yaw magnitude series. */
  static final class ResidualSeries {
    long[] times;
    double[] vertical;
    double[] lateral;
    double[] gyro;
    double[] yaw;
    boolean hasGyro;
  }

  /** Gravity removed with a rolling EMA; vertical is the projection on gravity. */
  static ResidualSeries residuals(List<Sample> samples, double alpha) {
    ResidualSeries series = new ResidualSeries();
    int n = samples.size();
    series.times = new long[n];
    series.vertical = new double[n];
    series.lateral = new double[n];
    series.gyro = new double[n];
    series.yaw = new double[n];
    if (n == 0) {
      return series;
    }
    double gx = samples.get(0).ax;
    double gy = samples.get(0).ay;
    double gz = samples.get(0).az;
    boolean hasGyro = false;
    for (int i = 0; i < n; i++) {
      Sample s = samples.get(i);
      gx += alpha * (s.ax - gx);
      gy += alpha * (s.ay - gy);
      gz += alpha * (s.az - gz);
      double gmag = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gmag == 0) {
        gmag = 1;
      }
      double hx = s.ax - gx;
      double hy = s.ay - gy;
      double hz = s.az - gz;
      double v = (hx * gx + hy * gy + hz * gz) / gmag;
      double hmag2 = hx * hx + hy * hy + hz * hz;
      series.times[i] = s.t;
      series.vertical[i] = v;
      series.lateral[i] = Math.sqrt(Math.max(0, hmag2 - v * v));
      if (s.hasGyro) {
        hasGyro = true;
        series.gyro[i] = Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);
        series.yaw[i] = (s.gx * gx + s.gy * gy + s.gz * gz) / gmag;
      }
    }
    series.hasGyro = hasGyro;
    return series;
  }

  /**
   * Coarse travel mode from fix speeds alone. Returns null when there is no
   * usable speed: no speed evidence is NOT vehicle evidence.
   */
  public static String resolveMode(List<Fix> fixes) {
    List<Double> speeds = new ArrayList<>();
    for (Fix fix : fixes) {
      if (fix.hasSpeed && fix.accuracy <= MAX_FIX_ACCURACY_M) {
        speeds.add(fix.speed * 3.6);
      }
    }
    if (speeds.isEmpty()) {
      return null;
    }
    return Signals.median(speeds) >= WALKING_MAX_KPH ? "vehicle" : "pedestrian";
  }

  /** TravelMode for a fused motion state, or null when the state cannot emit. */
  static String modeOf(String state) {
    if (MotionStateEstimator.VEHICLE.equals(state)) {
      return "vehicle";
    }
    if (MotionStateEstimator.CYCLING.equals(state)) {
      return "cycling";
    }
    if (MotionStateEstimator.WALKING.equals(state)) {
      return "pedestrian";
    }
    return null;
  }

  static ModeOptions modeConfig(String mode) {
    if ("vehicle".equals(mode)) {
      return VEHICLE_MODE;
    }
    if ("cycling".equals(mode)) {
      return CYCLING_MODE;
    }
    return PEDESTRIAN_MODE;
  }

  /**
   * Autonomous self-calibrating threshold using the rolling MAD envelope.
   * Dynamically rejects continuous chassis shudder without manual configuration.
   */
  static double adaptiveThreshold(String mode, ModeOptions cfg, double floorVal) {
    boolean isVehicle = "vehicle".equals(mode);
    double effectiveFloorAbs = isVehicle
        ? Math.max(cfg.absoluteFloor, 1.35 * floorVal)
        : cfg.absoluteFloor;
    double effectiveK = isVehicle
        ? cfg.noiseK + Math.min(1.0, Math.max(0.0, (floorVal - 0.6) * 0.5))
        : cfg.noiseK;
    return Math.max(effectiveFloorAbs, effectiveK * floorVal);
  }

  private static int severityOf(double normalised) {
    if (normalised >= SEVERE_NORMALISED) {
      return 3;
    }
    if (normalised >= MODERATE_NORMALISED) {
      return 2;
    }
    return 1;
  }

  /** True when the battery of evidence says a road-recording journey is under way. */
  public static boolean journeyMoving(
      List<Sample> samples, List<Fix> fixes, long now) {
    return MotionStateEstimator.decideJourney(samples, fixes, now).moving;
  }

  /** Characterise the pulse; reads the peak on the RAW residual, not the delayed filtered one. */
  static Features extractFeatures(
      ResidualSeries series, int centre, int spanBefore, int spanAfter, double[] band) {
    int from = Math.max(0, centre - spanBefore);
    int to = Math.min(series.vertical.length - 1, centre + spanAfter);
    double[] vertical = series.vertical;
    double[] lateral = series.lateral;

    int peakIndex = from;
    for (int i = from; i <= to; i++) {
      if (Math.abs(vertical[i]) > Math.abs(vertical[peakIndex])) {
        peakIndex = i;
      }
    }
    double peak = Math.abs(vertical[peakIndex]);
    double half = peak * 0.5;

    int start = peakIndex;
    while (start > from && Math.abs(vertical[start - 1]) > half) {
      start--;
    }
    int end = peakIndex;
    while (end < to && Math.abs(vertical[end + 1]) > half) {
      end++;
    }

    Features f = new Features();
    f.peak = round3(peak);
    f.riseMs = Math.round(Math.max(0, series.times[peakIndex] - series.times[start]));
    f.widthMs = Math.round(Math.max(0, series.times[end] - series.times[start]));

    double lobeFloor = peak * 0.4;
    int lobes = 0;
    for (int i = from + 1; i < to; i++) {
      double value = Math.abs(vertical[i]);
      if (value >= lobeFloor && value >= Math.abs(vertical[i - 1]) && value > Math.abs(vertical[i + 1])) {
        lobes++;
      }
    }
    f.lobes = Math.max(1, lobes);

    double jerk = 0;
    double lateralMax = 0;
    for (int i = from + 1; i <= to; i++) {
      double dt = (series.times[i] - series.times[i - 1]) / 1000.0;
      if (dt > 0) {
        jerk = Math.max(jerk, Math.abs(vertical[i] - vertical[i - 1]) / dt);
      }
      lateralMax = Math.max(lateralMax, Math.abs(lateral[i]));
    }
    f.jerk = round1(jerk);
    f.lateralRatio = round3(lateralMax / Math.max(peak, 0.001));

    if (band != null) {
      double bandEnergy = 0;
      double rawEnergy = 0;
      for (int i = from; i <= to; i++) {
        double b = band[i];
        double r = vertical[i];
        bandEnergy += b * b;
        rawEnergy += r * r;
      }
      f.roadBandRatio = round3(rawEnergy > 1e-9 ? Math.min(1, bandEnergy / rawEnergy) : 0);
    }
    if (series.hasGyro) {
      double gyroPeak = 0;
      double yawPeak = 0;
      for (int i = from; i <= to; i++) {
        gyroPeak = Math.max(gyroPeak, Math.abs(series.gyro[i]));
        yawPeak = Math.max(yawPeak, Math.abs(series.yaw[i]));
      }
      f.gyroPeakDps = round1(gyroPeak);
      f.yawPeakDps = round1(yawPeak);
    }
    return f;
  }

  static final class Classification {
    String kind;
    double score;
  }

  /**
   * Score the event against the three defect signatures and take the best.
   *
   * A pothole is a sharp, high-jerk, narrow pulse; a speed bump is a long,
   * low-jerk ramp; rough pavement is a band of many small lobes. Lateral load,
   * handling rotation and broadband energy are soft evidence against "road
   * defect", so an angled pothole survives while a kerb strike does not.
   */
  static Classification classify(Features f) {
    if (f.lateralRatio > MAX_LATERAL_RATIO) {
      return null;
    }
    // A swerve is lateral load AND rotation about the vertical axis.
    if (!Double.isNaN(f.yawPeakDps) && f.yawPeakDps >= YAW_REJECT_DPS
        && f.lateralRatio > SOFT_LATERAL_RATIO) {
      return null;
    }
    if (!Double.isNaN(f.gyroPeakDps) && f.gyroPeakDps >= HANDLING_GYRO_DPS * 2) {
      return null;
    }

    double lateralSpan = Math.max(1e-6, MAX_LATERAL_RATIO - SOFT_LATERAL_RATIO);
    double penalty = LATERAL_PENALTY
        * clamp((f.lateralRatio - SOFT_LATERAL_RATIO) / lateralSpan, 0, 1);
    if (!Double.isNaN(f.gyroPeakDps)) {
      penalty += 0.25 * clamp((f.gyroPeakDps - HANDLING_GYRO_DPS / 2) / HANDLING_GYRO_DPS, 0, 1);
    }
    if (!Double.isNaN(f.roadBandRatio)) {
      penalty += 0.25 * clamp(1 - f.roadBandRatio / MIN_ROAD_BAND_RATIO, 0, 1);
    }

    double sharpness = clamp(1 - f.riseMs / SHARP_RISE_MS, 0, 1);
    double width = clamp(f.widthMs / BUMP_MIN_WIDTH_MS, 0, 1);
    double lobes = clamp((f.lobes - 1) / 2.0, 0, 1);
    double jerk = clamp(f.jerk / Math.max(f.peak, 1) / JERK_REF, 0, 1);

    String[] kinds = {"pothole", "speed_bump", "rough_pavement"};
    double[] raw = {
      clamp(0.45 * sharpness + 0.3 * jerk + 0.25 * (1 - width) - 0.3 * lobes, 0, 1),
      clamp(0.6 * width + 0.25 * (1 - jerk) + 0.15 * (1 - sharpness) - 0.2 * lobes, 0, 1),
      clamp(0.55 * lobes + 0.25 * width + 0.2 * (1 - sharpness), 0, 1)
    };
    double[] scores = new double[raw.length];
    for (int i = 0; i < raw.length; i++) {
      scores[i] = clamp(raw[i] - penalty, 0, 1);
    }
    int best = 0;
    for (int i = 1; i < scores.length; i++) {
      if (scores[i] > scores[best]) {
        best = i;
      }
    }
    if (scores[best] < MIN_SCORE) {
      return null;
    }
    double runnerUp = 0;
    for (int i = 0; i < scores.length; i++) {
      if (i != best) {
        runnerUp = Math.max(runnerUp, scores[i]);
      }
    }
    double margin = clamp((scores[best] - runnerUp) / 0.25, 0, 1);
    Classification out = new Classification();
    out.kind = kinds[best];
    out.score = round3(clamp(0.7 * scores[best] + 0.3 * margin, 0, 1));
    return out;
  }

  public static List<Impact> detect(List<Sample> samples, List<Fix> fixes) {
    List<Impact> impacts = new ArrayList<>();
    if (samples.isEmpty()) {
      return impacts;
    }
    List<Sample> ordered = new ArrayList<>(samples);
    Collections.sort(ordered, Comparator.comparingLong(s -> s.t));

    List<Fix> trusted = Placement.sanitizeFixes(fixes);
    MotionStateEstimator.Timeline timeline =
        MotionStateEstimator.estimateMotionTimeline(ordered, trusted);

    ResidualSeries series = residuals(ordered, GRAVITY_ALPHA);
    int n = series.times.length;
    double intervalMs = Signals.medianInterval(series.times, 20);
    double sampleRate = 1000.0 / Math.max(1, intervalMs);
    Signals.Biquad coefficients = Signals.designBandpass(BAND_LOW_HZ, BAND_HIGH_HZ, sampleRate);
    double[] filtered =
        Signals.filterSegments(series.vertical, series.times, coefficients, GAP_RESET_MS);
    int windowSamples = (int) Math.max(5, Math.round(NOISE_WINDOW_MS / Math.max(1, intervalMs)));
    int stride = (int) Math.max(1, Math.round(windowSamples / 20.0));
    double[] floor = Signals.robustFloor(filtered, windowSamples, stride);

    JourneyCalibration.Options calibrationOptions = new JourneyCalibration.Options();
    calibrationOptions.learnMs = (long) LEARN_MS;
    JourneyCalibration.Result calibration =
        JourneyCalibration.calibrateJourney(filtered, series.times, timeline, calibrationOptions);

    int span = (int) Math.max(2, Math.round(250 / Math.max(1, intervalMs)));
    long lastEmit = Long.MIN_VALUE / 2;
    int i = 0;

    while (i < n) {
      String state = MotionStateEstimator.stateAt(timeline, series.times[i]);
      String mode = MotionStateEstimator.emitsImpacts(state) ? modeOf(state) : null;
      if (mode == null) {
        i++;
        continue;
      }
      ModeOptions modeCfg = modeConfig(mode);
      double threshold = adaptiveThreshold(mode, modeCfg, floorAt(floor, calibration, series.times, i));
      if (Math.abs(filtered[i]) < threshold) {
        i++;
        continue;
      }
      int peakIndex = i;
      int j = i;
      while (j < n) {
        double t = adaptiveThreshold(mode, modeCfg, floorAt(floor, calibration, series.times, j));
        if (Math.abs(filtered[j]) < t * RELEASE_FRACTION) {
          break;
        }
        if (Math.abs(filtered[j]) > Math.abs(filtered[peakIndex])) {
          peakIndex = j;
        }
        j++;
      }
      i = Math.max(j, i + 1);

      long peakTime = series.times[peakIndex];
      if (peakTime - lastEmit < DEBOUNCE_MS) {
        continue;
      }
      // The mode must still hold at the instant of the peak.
      if (!mode.equals(modeOf(MotionStateEstimator.stateAt(timeline, peakTime)))) {
        continue;
      }

      Placement.Position place = Placement.placeAt(trusted, peakTime);
      if (place == null) {
        continue;
      }
      double speedKph = place.speedKph;
      if (speedKph < modeCfg.minSpeedKph || speedKph > modeCfg.maxSpeedKph) {
        continue;
      }

      Features features = extractFeatures(series, peakIndex, span, span, filtered);
      Classification classification = classify(features);
      if (classification == null) {
        continue;
      }

      double snr = clamp(
          features.peak / Math.max(floorAt(floor, calibration, series.times, peakIndex), 0.1) / 8, 0, 1);
      double accuracyFactor = clamp(1 - place.accuracy / 40, 0, 1);
      double confidence = round3(
          clamp(0.55 * classification.score + 0.3 * snr + 0.15 * accuracyFactor, 0, 1));

      double gain = clamp(speedKph / SPEED_REFERENCE_KPH, 0.6, 1.8);
      double normalised = round2(features.peak / gain);
      int severity = severityOf(normalised);
      String kind = classification.kind;
      if ("cycling".equals(mode)) {
        // A bicycle's wheel and rider are not a calibrated road sensor.
        severity = Math.min(severity, CYCLING_MAX_SEVERITY);
        if ("pothole".equals(kind)) {
          kind = "rough_pavement";
        }
        confidence = round3(confidence * CYCLING_CONFIDENCE_SCALE);
      }

      Impact impact = new Impact();
      impact.t = peakTime;
      impact.lat = place.lat;
      impact.lng = place.lng;
      impact.accuracy = place.accuracy;
      impact.speedKph = speedKph;
      impact.magnitude = features.peak;
      impact.normalised = normalised;
      impact.severity = severity;
      impact.kind = kind;
      impact.confidence = confidence;
      impact.mode = mode;
      impact.features = features;
      impact.motionState = state;
      impacts.add(impact);
      lastEmit = peakTime;
    }
    return impacts;
  }

  /** Rolling floor, lower-bounded by the per-journey calibration once it is ready. */
  private static double floorAt(
      double[] floor, JourneyCalibration.Result calibration, long[] times, int index) {
    double rolling = floor[index];
    if (calibration.ready && times[index] >= calibration.readyAt) {
      return Math.max(rolling, CALIBRATION_FLOOR_SHARE * calibration.floor);
    }
    return rolling;
  }

  public static List<Impact> detect(List<Sample> samples, List<Fix> fixes, String vehicleProfile) {
    return detect(samples, fixes);
  }

  public static double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    double earth = 6371008.8;
    double dLat = Math.toRadians(lat2 - lat1);
    double dLng = Math.toRadians(lng2 - lng1);
    double a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1))
                * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2)
                * Math.sin(dLng / 2);
    return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  private static String dayOf(long t) {
    return new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        .format(new java.util.Date(t));
  }

  public static List<Hazard> cluster(List<Observed> observed, long now) {
    Collections.sort(observed, (a, b) -> Long.compare(a.impact.t, b.impact.t));
    List<List<Observed>> groups = new ArrayList<>();
    for (Observed item : observed) {
      boolean placed = false;
      for (List<Observed> group : groups) {
        double lat = 0;
        double lng = 0;
        for (Observed member : group) {
          lat += member.impact.lat;
          lng += member.impact.lng;
        }
        double cLat = lat / group.size();
        double cLng = lng / group.size();
        if (haversineMeters(cLat, cLng, item.impact.lat, item.impact.lng) <= MERGE_DISTANCE_M) {
          group.add(item);
          placed = true;
          break;
        }
      }
      if (!placed) {
        List<Observed> group = new ArrayList<>();
        group.add(item);
        groups.add(group);
      }
    }

    List<Hazard> hazards = new ArrayList<>();
    for (List<Observed> group : groups) {
      double lat = 0;
      double lng = 0;
      Set<String> devices = new HashSet<>();
      Set<String> days = new HashSet<>();
      long firstSeen = Long.MAX_VALUE;
      long lastSeen = Long.MIN_VALUE;
      double quality = 0;
      int severity = 0;
      List<String> kinds = new ArrayList<>();
      for (Observed member : group) {
        lat += member.impact.lat;
        lng += member.impact.lng;
        devices.add(member.deviceId);
        days.add(dayOf(member.impact.t));
        firstSeen = Math.min(firstSeen, member.impact.t);
        lastSeen = Math.max(lastSeen, member.impact.t);
        quality += member.impact.confidence;
        severity = Math.max(severity, member.impact.severity);
        kinds.add(member.impact.kind);
      }
      double cLat = lat / group.size();
      double cLng = lng / group.size();
      int passCount = group.size();
      int deviceCount = devices.size();
      quality /= group.size();

      double passFactor = Math.min(1, passCount / (double) PUBLISH_MIN_PASSES);
      double deviceFactor = Math.min(1, deviceCount / (double) PUBLISH_MIN_DEVICES);
      double ageDays = Math.max(0, (now - lastSeen) / 86400000.0);
      double recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      double belief = clamp(0.45 * passFactor + 0.3 * deviceFactor + 0.25 * quality, 0, 1);

      Hazard hazard = new Hazard();
      hazard.id = String.format(java.util.Locale.US, "%.4f:%.4f", cLat, cLng);
      hazard.lat = cLat;
      hazard.lng = cLng;
      hazard.kind = majority(kinds);
      hazard.severity = severity;
      hazard.passCount = passCount;
      hazard.deviceCount = deviceCount;
      hazard.dayCount = days.size();
      hazard.confidence = clamp(belief * recency, 0, 1);
      hazard.firstSeen = firstSeen;
      hazard.lastSeen = lastSeen;
      hazard.published = passCount >= PUBLISH_MIN_PASSES && deviceCount >= PUBLISH_MIN_DEVICES;
      hazards.add(hazard);
    }
    return hazards;
  }

  private static final double PASS_DISTANCE_M = 22;
  private static final double PASS_IMPACT_DISTANCE_M = 25;
  private static final double PASS_MAX_FIX_ACCURACY_M = 25;
  private static final double PASS_MIN_SPEED_MS = 2.5; // cycling or driving, not parking
  private static final double PASS_MAX_SPEED_MS = 45.0;
  private static final double PASS_MIN_DISPLACEMENT_M = 4.0;
  private static final long PASS_MIN_INTERVAL_MS = 500;
  private static final long PASS_MAX_INTERVAL_MS = 20000;
  private static final long PASS_SENSOR_WINDOW_MS = 1500;
  private static final long PASS_MIN_SENSOR_SPAN_MS = 400;

  /** Requires actual on-device motion samples near BOTH passage fixes. */
  private static boolean sensorCoveredAt(List<Long> times, long at) {
    if (times == null || times.isEmpty() || at <= 0) return false;
    long from = at - PASS_SENSOR_WINDOW_MS;
    long to = at + PASS_SENSOR_WINDOW_MS;
    int start = Collections.binarySearch(times, from);
    if (start < 0) start = -start - 1;
    long first = -1;
    for (int i = start; i < times.size(); i++) {
      long observed = times.get(i);
      if (observed > to) break;
      if (first < 0) first = observed;
      else if (observed - first >= PASS_MIN_SENSOR_SPAN_MS) return true;
    }
    return false;
  }

  private static boolean reliableMovingFix(Fix fix) {
    return fix != null && fix.t > 0 && fix.hasSpeed
        && Double.isFinite(fix.lat) && Math.abs(fix.lat) <= 90
        && Double.isFinite(fix.lng) && Math.abs(fix.lng) <= 180
        && Double.isFinite(fix.accuracy) && fix.accuracy >= 0
        && fix.accuracy <= PASS_MAX_FIX_ACCURACY_M
        && Double.isFinite(fix.speed) && fix.speed >= PASS_MIN_SPEED_MS
        && fix.speed <= PASS_MAX_SPEED_MS;
  }

  /**
   * A single GPS point beside a hazard is NOT evidence of a clear road: the
   * phone might be parked, GPS might drift, or the sensor may have stopped.
   * Require two distinct, accurate, moving fixes close to the hazard AND
   * accelerometer coverage at both positions. When in doubt, preserve it.
   */
  public static List<Hazard> passedHazards(
      List<Fix> fixes, List<Hazard> known, List<Impact> impacts,
      List<Long> motionTimes) {
    List<Hazard> passed = new ArrayList<>();
    for (Hazard hazard : known) {
      if (hazard == null || !Double.isFinite(hazard.lat) || !Double.isFinite(hazard.lng)
          || Math.abs(hazard.lat) > 90 || Math.abs(hazard.lng) > 180) {
        continue;
      }
      Fix previous = null;
      boolean travelled = false;
      for (Fix fix : fixes) {
        if (!reliableMovingFix(fix) ||
            haversineMeters(fix.lat, fix.lng, hazard.lat, hazard.lng) > PASS_DISTANCE_M) {
          continue;
        }
        if (previous != null) {
          long elapsed = fix.t - previous.t;
          if (elapsed >= PASS_MIN_INTERVAL_MS && elapsed <= PASS_MAX_INTERVAL_MS
              && haversineMeters(previous.lat, previous.lng, fix.lat, fix.lng)
                  >= PASS_MIN_DISPLACEMENT_M
              && sensorCoveredAt(motionTimes, previous.t)
              && sensorCoveredAt(motionTimes, fix.t)) {
            travelled = true;
            break;
          }
        }
        previous = fix;
      }
      if (!travelled) continue;
      boolean felt = false;
      for (Impact impact : impacts) {
        if (impact != null && Double.isFinite(impact.lat) && Double.isFinite(impact.lng)
            && haversineMeters(impact.lat, impact.lng, hazard.lat, hazard.lng)
                <= PASS_IMPACT_DISTANCE_M) {
          felt = true;
          break;
        }
      }
      if (!felt) passed.add(hazard);
    }
    return passed;
  }

  private static String majority(List<String> values) {
    String best = "pothole";
    int bestCount = -1;
    for (String candidate : values) {
      int count = 0;
      for (String value : values) {
        if (value.equals(candidate)) {
          count++;
        }
      }
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    return best;
  }
}

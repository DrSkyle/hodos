package org.hodos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Native port of the @hodos/core detection pipeline, so detection can run in a
 * background service without a WebView. Keep the constants in step with
 * packages/core: the two implementations are checked against the same shapes.
 */
public final class MotionDetector {

  public static final class Sample {
    public long t;
    public double ax;
    public double ay;
    public double az;

    public Sample(long t, double ax, double ay, double az) {
      this.t = t;
      this.ax = ax;
      this.ay = ay;
      this.az = az;
    }
  }

  public static final class Fix {
    public long t;
    public double lat;
    public double lng;
    public double accuracy;
    public double speed;
    public boolean hasSpeed;

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
    public String mode;
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

  private static final double GRAVITY_ALPHA = 0.02;
  private static final double BAND_LOW_HZ = 0.5;
  private static final double BAND_HIGH_HZ = 6.0;
  private static final double NOISE_WINDOW_MS = 2000;
  private static final double DEBOUNCE_MS = 1500;
  private static final double MAX_FIX_AGE_MS = 3000;
  private static final double MAX_FIX_ACCURACY_M = 50;
  private static final double RELEASE_FRACTION = 0.5;
  private static final double WALKING_MAX_KPH = 10;
  private static final double SPEED_REFERENCE_KPH = 35;
  private static final double MODERATE_NORMALISED = 6;
  private static final double SEVERE_NORMALISED = 12;

  private static final double SHARP_RISE_MS = 60;
  private static final double BUMP_MIN_WIDTH_MS = 180;
  private static final double JERK_REF = 50;
  private static final double MAX_LATERAL_RATIO = 0.8;
  private static final double MIN_SCORE = 0.5;

  private static final double VEHICLE_FLOOR = 1.6;
  private static final double VEHICLE_K = 3.0;
  private static final double VEHICLE_MIN_KPH = 12;
  private static final double PEDESTRIAN_FLOOR = 0.9;
  private static final double PEDESTRIAN_K = 4.5;
  private static final double PEDESTRIAN_MIN_KPH = 1;

  private static final double MERGE_DISTANCE_M = 15;
  private static final int PUBLISH_MIN_PASSES = 3;
  private static final int PUBLISH_MIN_DEVICES = 2;
  private static final double HALF_LIFE_DAYS = 90;

  private MotionDetector() {}

  private static double median(List<Double> values) {
    if (values.isEmpty()) {
      return 0;
    }
    List<Double> sorted = new ArrayList<>(values);
    Collections.sort(sorted);
    int mid = sorted.size() / 2;
    if (sorted.size() % 2 == 1) {
      return sorted.get(mid);
    }
    return (sorted.get(mid - 1) + sorted.get(mid)) / 2;
  }

  private static double medianInterval(List<Long> times) {
    if (times.size() < 2) {
      return 20;
    }
    List<Double> deltas = new ArrayList<>();
    for (int i = 1; i < times.size(); i++) {
      deltas.add((double) (times.get(i) - times.get(i - 1)));
    }
    double value = median(deltas);
    return value > 0 ? value : 20;
  }

  private static final class Biquad {
    double b0, b1, b2, a1, a2;
  }

  private static Biquad designBandpass(double lowHz, double highHz, double sampleRate) {
    double centre = Math.sqrt(lowHz * highHz);
    double w0 = 2 * Math.PI * centre / sampleRate;
    double q = centre / (highHz - lowHz);
    double alpha = Math.sin(w0) / (2 * q);
    double cosw = Math.cos(w0);
    double a0 = 1 + alpha;
    Biquad c = new Biquad();
    c.b0 = alpha / a0;
    c.b1 = 0;
    c.b2 = -alpha / a0;
    c.a1 = -2 * cosw / a0;
    c.a2 = (1 - alpha) / a0;
    return c;
  }

  private static double[] filter(double[] signal, Biquad c) {
    double[] out = new double[signal.length];
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (int i = 0; i < signal.length; i++) {
      double x = signal[i];
      double y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      out[i] = y;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
    return out;
  }

  private static double[] robustFloor(double[] values, int window, int stride) {
    double[] out = new double[values.length];
    List<Double> scratch = new ArrayList<>();
    double current = 0;
    for (int i = 0; i < values.length; i++) {
      if (i % stride == 0) {
        int from = Math.max(0, i - window + 1);
        scratch.clear();
        for (int j = from; j <= i; j++) {
          scratch.add(Math.abs(values[j]));
        }
        current = 1.4826 * median(scratch);
      }
      out[i] = current;
    }
    return out;
  }

  private static double clamp(double value, double low, double high) {
    return Math.min(high, Math.max(low, value));
  }

  private static Features extractFeatures(
      long[] times, double[] vertical, double[] lateral, int centre, int spanBefore, int spanAfter) {
    int from = Math.max(0, centre - spanBefore);
    int to = Math.min(vertical.length - 1, centre + spanAfter);

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
    f.peak = peak;
    f.riseMs = Math.max(0, times[peakIndex] - times[start]);
    f.widthMs = Math.max(0, times[end] - times[start]);

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
      double dt = (times[i] - times[i - 1]) / 1000.0;
      if (dt > 0) {
        jerk = Math.max(jerk, Math.abs(vertical[i] - vertical[i - 1]) / dt);
      }
      lateralMax = Math.max(lateralMax, Math.abs(lateral[i]));
    }
    f.jerk = jerk;
    f.lateralRatio = lateralMax / Math.max(peak, 0.001);
    return f;
  }

  private static final class Classification {
    String kind;
    double score;
  }

  private static Classification classify(Features f) {
    if (f.lateralRatio > MAX_LATERAL_RATIO) {
      return null;
    }
    double sharpness = clamp(1 - f.riseMs / SHARP_RISE_MS, 0, 1);
    double width = clamp(f.widthMs / BUMP_MIN_WIDTH_MS, 0, 1);
    double lobes = clamp((f.lobes - 1) / 2.0, 0, 1);
    double jerk = clamp(f.jerk / Math.max(f.peak, 1) / JERK_REF, 0, 1);

    String[] kinds = {"pothole", "speed_bump", "rough_pavement"};
    double[] scores = {
      clamp(0.45 * sharpness + 0.3 * jerk + 0.25 * (1 - width) - 0.3 * lobes, 0, 1),
      clamp(0.6 * width + 0.25 * (1 - jerk) + 0.15 * (1 - sharpness) - 0.2 * lobes, 0, 1),
      clamp(0.55 * lobes + 0.25 * width + 0.2 * (1 - sharpness), 0, 1)
    };
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
    out.score = clamp(0.7 * scores[best] + 0.3 * margin, 0, 1);
    return out;
  }

  private static String resolveMode(List<Fix> fixes) {
    List<Double> speeds = new ArrayList<>();
    for (Fix fix : fixes) {
      if (fix.hasSpeed) {
        speeds.add(fix.speed * 3.6);
      }
    }
    if (speeds.isEmpty()) {
      return "vehicle";
    }
    return median(speeds) >= WALKING_MAX_KPH ? "vehicle" : "pedestrian";
  }

  private static Fix nearestFix(List<Fix> fixes, long t) {
    Fix best = null;
    double bestDelta = Double.POSITIVE_INFINITY;
    for (Fix fix : fixes) {
      double delta = Math.abs(fix.t - t);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = fix;
      }
    }
    if (best == null || bestDelta > MAX_FIX_AGE_MS) {
      return null;
    }
    return best;
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

  public static List<Impact> detect(List<Sample> samples, List<Fix> fixes) {
    List<Impact> impacts = new ArrayList<>();
    if (samples.isEmpty()) {
      return impacts;
    }

    int n = samples.size();
    long[] times = new long[n];
    double[] vertical = new double[n];
    double[] lateral = new double[n];
    double gx = samples.get(0).ax;
    double gy = samples.get(0).ay;
    double gz = samples.get(0).az;
    List<Long> timeList = new ArrayList<>(n);

    for (int i = 0; i < n; i++) {
      Sample s = samples.get(i);
      gx += GRAVITY_ALPHA * (s.ax - gx);
      gy += GRAVITY_ALPHA * (s.ay - gy);
      gz += GRAVITY_ALPHA * (s.az - gz);
      double gmag = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gmag == 0) {
        gmag = 1;
      }
      double hx = s.ax - gx;
      double hy = s.ay - gy;
      double hz = s.az - gz;
      double v = (hx * gx + hy * gy + hz * gz) / gmag;
      double hmag = Math.sqrt(hx * hx + hy * hy + hz * hz);
      times[i] = s.t;
      vertical[i] = v;
      lateral[i] = Math.sqrt(Math.max(0, hmag * hmag - v * v));
      timeList.add(s.t);
    }

    double intervalMs = medianInterval(timeList);
    double sampleRate = 1000.0 / Math.max(1, intervalMs);
    double[] filtered = filter(vertical, designBandpass(BAND_LOW_HZ, BAND_HIGH_HZ, sampleRate));
    int windowSamples = (int) Math.max(5, Math.round(NOISE_WINDOW_MS / Math.max(1, intervalMs)));
    int stride = Math.max(1, Math.round(windowSamples / 20.0));
    double[] floor = robustFloor(filtered, windowSamples, stride);

    String mode = resolveMode(fixes);
    boolean vehicle = "vehicle".equals(mode);
    double floorAbs = vehicle ? VEHICLE_FLOOR : PEDESTRIAN_FLOOR;
    double noiseK = vehicle ? VEHICLE_K : PEDESTRIAN_K;
    double minSpeedKph = vehicle ? VEHICLE_MIN_KPH : PEDESTRIAN_MIN_KPH;
    int span = (int) Math.max(2, Math.round(250 / Math.max(1, intervalMs)));

    long lastEmit = Long.MIN_VALUE / 2;
    int i = 0;
    while (i < n) {
      double threshold = Math.max(floorAbs, noiseK * floor[i]);
      if (Math.abs(filtered[i]) < threshold) {
        i++;
        continue;
      }
      int peakIndex = i;
      int j = i;
      while (j < n) {
        double t = Math.max(floorAbs, noiseK * floor[j]);
        if (Math.abs(filtered[j]) < t * RELEASE_FRACTION) {
          break;
        }
        if (Math.abs(filtered[j]) > Math.abs(filtered[peakIndex])) {
          peakIndex = j;
        }
        j++;
      }
      i = Math.max(j, i + 1);

      long peakTime = times[peakIndex];
      if (peakTime - lastEmit < DEBOUNCE_MS) {
        continue;
      }
      Fix fix = nearestFix(fixes, peakTime);
      if (fix == null || fix.accuracy > MAX_FIX_ACCURACY_M) {
        continue;
      }
      double speedKph = (fix.hasSpeed ? fix.speed : 0) * 3.6;
      if (speedKph < minSpeedKph) {
        continue;
      }

      Features features = extractFeatures(times, vertical, lateral, peakIndex, span, span);
      Classification classification = classify(features);
      if (classification == null) {
        continue;
      }

      double snr = clamp(features.peak / Math.max(floor[peakIndex], 0.1) / 8, 0, 1);
      double accuracyFactor = clamp(1 - fix.accuracy / 40, 0, 1);
      double gain = clamp(speedKph / SPEED_REFERENCE_KPH, 0.6, 1.8);

      Impact impact = new Impact();
      impact.t = peakTime;
      impact.lat = fix.lat;
      impact.lng = fix.lng;
      impact.accuracy = fix.accuracy;
      impact.speedKph = speedKph;
      impact.magnitude = features.peak;
      impact.normalised = features.peak / gain;
      impact.severity = severityOf(impact.normalised);
      impact.kind = classification.kind;
      impact.confidence = clamp(0.55 * classification.score + 0.3 * snr + 0.15 * accuracyFactor, 0, 1);
      impact.mode = mode;
      impacts.add(impact);
      lastEmit = peakTime;
    }
    return impacts;
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

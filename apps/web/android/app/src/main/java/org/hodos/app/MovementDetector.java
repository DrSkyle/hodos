package org.hodos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.TreeMap;

/**
 * Fused journey-onset detection, used instead of a single speed threshold.
 *
 * A speed check alone is both too slow (a scooter at 12 km/h never crosses it)
 * and too fragile (one bad fix looks like driving). This combines three
 * independent observations and only starts a journey when they agree:
 *
 *  1. Sustained accelerometer energy above an adaptive, self-calibrated still
 *     baseline. This is the engine/road vibration a moving vehicle always has.
 *  2. GPS speed or consistent displacement across several accurate fixes.
 *  3. The platform step detector, which vetoes walking so carrying the phone
 *     or walking a bike never begins a road-recording journey.
 *
 * The detector is stateless and deterministic so it can be unit tested without
 * Android sensors; the service owns buffering and hysteresis.
 */
public final class MovementDetector {

  public static final class Accel {
    public final long t;
    public final double ax;
    public final double ay;
    public final double az;

    public Accel(long t, double ax, double ay, double az) {
      this.t = t;
      this.ax = ax;
      this.ay = ay;
      this.az = az;
    }
  }

  public static final class Fix {
    public final long t;
    public final double lat;
    public final double lng;
    public final double speed;
    public final boolean hasSpeed;
    public final double accuracy;

    public Fix(long t, double lat, double lng, double speed, boolean hasSpeed, double accuracy) {
      this.t = t;
      this.lat = lat;
      this.lng = lng;
      this.speed = speed;
      this.hasSpeed = hasSpeed;
      this.accuracy = accuracy;
    }
  }

  public static final class Decision {
    public boolean moving;
    public double confidence;
    public double motionRms;
    public double baselineRms;
    public double gpsSpeedMps;
    public double displacementSpeedMps;
    public double vibrationSeconds;
    public boolean walkingVeto;
    public String reason = "still";
  }

  private static final long ACCEL_WINDOW_MS = 12_000L;
  private static final long MIN_ACCEL_SPAN_MS = 5_000L;
  private static final long BUCKET_MS = 500L;
  private static final long VIBRATION_SUSTAIN_MS = 4_000L;
  private static final long GPS_WINDOW_MS = 12_000L;
  private static final long STEP_VETO_MS = 3_000L;
  private static final long MIN_DISPLACEMENT_SPAN_MS = 3_000L;

  private static final double VIBRATION_FLOOR_RMS = 0.20;
  private static final double BASELINE_FRACTION = 0.6;
  private static final double BASELINE_CAP_RMS = 0.9;
  private static final double MAX_ACCURACY_M = 50;
  private static final double GPS_SPEED_MPS = 2.0;
  private static final double DISPLACEMENT_MIN_MPS = 1.6;
  private static final double MIN_DISPLACEMENT_M = 15;
  private static final double MAX_SPEED_MPS = 45;
  private static final double MIN_CONFIDENCE = 0.55;

  private static final double EARTH_RADIUS_M = 6371008.8;

  private MovementDetector() {}

  public static Decision evaluate(
      List<Accel> accelSamples, List<Fix> fixes, long lastStepAt, long now) {
    Decision decision = new Decision();

    AccelStats stats = accelStats(accelSamples, now);
    decision.motionRms = round3(stats.motionRms);
    decision.baselineRms = round3(stats.baselineRms);
    decision.vibrationSeconds = round1(stats.sustainMs / 1000.0);

    GpsStats gps = gpsStats(fixes, now);
    decision.gpsSpeedMps = round3(gps.maxSpeed);
    decision.displacementSpeedMps = round3(gps.displacementSpeed);

    decision.walkingVeto =
        lastStepAt > 0 && now >= lastStepAt && now - lastStepAt <= STEP_VETO_MS;

    boolean vibration = stats.sustainMs >= VIBRATION_SUSTAIN_MS;
    boolean gpsMoving = gps.maxSpeed >= GPS_SPEED_MPS || gps.moved;

    if (decision.walkingVeto) {
      decision.reason = "walking";
      return decision;
    }
    if (gpsMoving && vibration) {
      decision.moving = true;
      decision.confidence = 0.95;
      decision.reason = "vibration+gps";
    } else if (gpsMoving) {
      decision.moving = true;
      decision.confidence = 0.75;
      decision.reason = "gps";
    } else if (vibration && gps.fixCount == 0) {
      // No GPS fix yet (tunnel, cold start, indoor). Trust the vibration
      // evidence rather than silently missing a journey.
      decision.moving = true;
      decision.confidence = 0.6;
      decision.reason = "vibration";
    } else if (vibration) {
      // Vibration but GPS says still: could be handling the phone or a
      // stationary engine. Require more evidence next cycle.
      decision.confidence = 0.5;
      decision.reason = "vibration-unconfirmed";
    } else if (gpsMoving) {
      decision.confidence = 0.5;
      decision.reason = "gps-unconfirmed";
    } else {
      decision.confidence = 0;
      decision.reason = "still";
    }
    decision.moving = decision.moving && decision.confidence >= MIN_CONFIDENCE;
    return decision;
  }

  private static final class AccelStats {
    double motionRms;
    double baselineRms;
    long sustainMs;
  }

  private static AccelStats accelStats(List<Accel> samples, long now) {
    AccelStats out = new AccelStats();
    if (samples == null || samples.isEmpty()) {
      return out;
    }
    List<Accel> window = new ArrayList<>();
    long from = now - ACCEL_WINDOW_MS;
    for (Accel sample : samples) {
      if (sample.t >= from && sample.t <= now) {
        window.add(sample);
      }
    }
    if (window.isEmpty()) {
      return out;
    }
    Collections.sort(window, Comparator.comparingLong(a -> a.t));

    long first = window.get(0).t;
    long last = window.get(window.size() - 1).t;
    if (last - first < MIN_ACCEL_SPAN_MS || window.size() < 20) {
      return out;
    }

    // Mean vector is gravity. Linear acceleration is what remains.
    double gx = 0;
    double gy = 0;
    double gz = 0;
    for (Accel sample : window) {
      gx += sample.ax;
      gy += sample.ay;
      gz += sample.az;
    }
    gx /= window.size();
    gy /= window.size();
    gz /= window.size();

    TreeMap<Integer, double[]> buckets = new TreeMap<>();
    double sumSquares = 0;
    for (Accel sample : window) {
      double lx = sample.ax - gx;
      double ly = sample.ay - gy;
      double lz = sample.az - gz;
      double magnitude = Math.sqrt(lx * lx + ly * ly + lz * lz);
      sumSquares += magnitude * magnitude;
      int bucket = (int) ((sample.t - first) / BUCKET_MS);
      double[] entry = buckets.get(bucket);
      if (entry == null) {
        entry = new double[2];
        buckets.put(bucket, entry);
      }
      entry[0] += magnitude * magnitude;
      entry[1] += 1;
    }
    out.motionRms = Math.sqrt(sumSquares / window.size());

    List<Double> bucketRms = new ArrayList<>();
    for (double[] entry : buckets.values()) {
      bucketRms.add(Math.sqrt(entry[0] / Math.max(1, entry[1])));
    }
    if (bucketRms.isEmpty()) {
      return out;
    }
    Collections.sort(bucketRms);
    out.baselineRms = percentile(bucketRms, 0.25);
    double threshold = Math.max(
        VIBRATION_FLOOR_RMS, Math.min(BASELINE_CAP_RMS, out.baselineRms * BASELINE_FRACTION));

    // Count the trailing run of buckets above the floor. A single jolt (phone
    // pickup, pothole) is shorter than the sustain requirement.
    int lastBucket = buckets.lastKey();
    long sustain = 0;
    for (int key = lastBucket; key >= 0; key--) {
      double[] entry = buckets.get(key);
      if (entry == null) {
        break;
      }
      double rms = Math.sqrt(entry[0] / Math.max(1, entry[1]));
      if (rms < threshold) {
        break;
      }
      sustain += BUCKET_MS;
    }
    out.sustainMs = sustain;
    return out;
  }

  private static final class GpsStats {
    int fixCount;
    double maxSpeed;
    double displacementSpeed;
    boolean moved;
  }

  private static GpsStats gpsStats(List<Fix> fixes, long now) {
    GpsStats out = new GpsStats();
    if (fixes == null || fixes.isEmpty()) {
      return out;
    }
    List<Fix> valid = new ArrayList<>();
    long from = now - GPS_WINDOW_MS;
    for (Fix fix : fixes) {
      if (fix.t < from || fix.t > now) {
        continue;
      }
      if (!Double.isFinite(fix.lat) || !Double.isFinite(fix.lng)
          || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180
          || !Double.isFinite(fix.accuracy) || fix.accuracy < 0
          || fix.accuracy > MAX_ACCURACY_M) {
        continue;
      }
      valid.add(fix);
      if (fix.hasSpeed && Double.isFinite(fix.speed)
          && fix.speed >= 0 && fix.speed <= MAX_SPEED_MPS) {
        out.maxSpeed = Math.max(out.maxSpeed, fix.speed);
      }
    }
    out.fixCount = valid.size();
    if (valid.size() < 2) {
      return out;
    }
    Collections.sort(valid, Comparator.comparingLong(f -> f.t));
    Fix first = valid.get(0);
    Fix last = valid.get(valid.size() - 1);
    long elapsed = last.t - first.t;
    if (elapsed < MIN_DISPLACEMENT_SPAN_MS) {
      return out;
    }
    double distance = haversineMeters(first.lat, first.lng, last.lat, last.lng);
    // Reject impossible multipath jumps before they can look like speed.
    if (!Double.isFinite(distance) || distance > elapsed / 1000.0 * MAX_SPEED_MPS + 30) {
      return out;
    }
    out.displacementSpeed = distance / (elapsed / 1000.0);
    out.moved = distance >= MIN_DISPLACEMENT_M
        && out.displacementSpeed >= DISPLACEMENT_MIN_MPS;
    return out;
  }

  private static double percentile(List<Double> sorted, double fraction) {
    if (sorted.isEmpty()) {
      return 0;
    }
    int index = (int) Math.round(fraction * (sorted.size() - 1));
    index = Math.max(0, Math.min(sorted.size() - 1, index));
    return sorted.get(index);
  }

  static double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    double dLat = Math.toRadians(lat2 - lat1);
    double dLng = Math.toRadians(lng2 - lng1);
    double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  private static double round3(double value) {
    return Math.round(value * 1000.0) / 1000.0;
  }

  private static double round1(double value) {
    return Math.round(value * 10.0) / 10.0;
  }
}

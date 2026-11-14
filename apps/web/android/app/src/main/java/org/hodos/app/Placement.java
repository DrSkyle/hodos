package org.hodos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Native port of packages/core/src/placement.ts.
 *
 * A road observation is only worth recording if it can be placed on the road.
 * Two rules enforce that, and they are the same rules the TypeScript side uses:
 *
 *  - `sanitizeFixes` keeps only fixes a road observation can be built on
 *    (finite, in range, accurate, ordered, physically reachable from the
 *    previous kept fix). If three fixes in a row are rejected the anchor was
 *    probably the bad one, so it re-anchors on the newest.
 *  - `placeAt` interpolates the position between two bracketing trusted fixes.
 *    Inside a GPS gap longer than `maxGapMs` — a tunnel, an underpass — there is
 *    no placement, so nothing is fabricated when GPS returns.
 *
 * Parity rules: Math.sqrt only, no Math.hypot, identical operation order.
 */
public final class Placement {

  public static final class Options {
    public double maxFixAccuracyM = 50;
    public double maxGapMs = 5000;
    public double maxFixAgeMs = 3000;
    public double edgeMs = 1500;
    public double maxTransitionMps = 45;
  }

  public static final Options DEFAULTS = new Options();

  public static final class Position {
    public double lat;
    public double lng;
    public double accuracy;
    public double speedKph;
  }

  private Placement() {}

  /** Keep only fixes a road observation can be built on. */
  public static List<MotionDetector.Fix> sanitizeFixes(List<MotionDetector.Fix> fixes) {
    return sanitizeFixes(fixes, DEFAULTS);
  }

  public static List<MotionDetector.Fix> sanitizeFixes(List<MotionDetector.Fix> fixes, Options o) {
    List<MotionDetector.Fix> sorted = new ArrayList<>(fixes);
    Collections.sort(sorted, Comparator.comparingLong(f -> f.t));
    List<MotionDetector.Fix> kept = new ArrayList<>();
    int rejectedRun = 0;
    for (MotionDetector.Fix fix : sorted) {
      if (!isFinite(fix.lat) || !isFinite(fix.lng) ||
          Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 ||
          !isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > o.maxFixAccuracyM) {
        continue;
      }
      if (!kept.isEmpty()) {
        MotionDetector.Fix prev = kept.get(kept.size() - 1);
        if (fix.t <= prev.t) {
          continue;
        }
        double dt = (fix.t - prev.t) / 1000.0;
        if (haversine(prev, fix) > dt * o.maxTransitionMps + 30) {
          rejectedRun += 1;
          if (rejectedRun < 3) {
            continue;
          }
        }
      }
      rejectedRun = 0;
      kept.add(fix);
    }
    return kept;
  }

  /** A credible road position for an event at time `t`, or null. */
  public static Position placeAt(List<MotionDetector.Fix> fixes, long t) {
    return placeAt(fixes, t, DEFAULTS);
  }

  public static Position placeAt(List<MotionDetector.Fix> fixes, long t, Options o) {
    int lo = 0;
    int hi = fixes.size();
    while (lo < hi) {
      int mid = (lo + hi) >>> 1;
      if (fixes.get(mid).t < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    MotionDetector.Fix before = lo > 0 ? fixes.get(lo - 1) : null;
    MotionDetector.Fix after = lo < fixes.size() ? fixes.get(lo) : null;

    if (before != null && after != null) {
      double gap = after.t - before.t;
      if (gap > o.maxGapMs ||
          Math.min(t - before.t, after.t - t) > o.maxFixAgeMs) {
        return null;
      }
      double w = gap > 0 ? (t - before.t) / gap : 0;
      Position p = new Position();
      p.lat = before.lat + (after.lat - before.lat) * w;
      p.lng = before.lng + (after.lng - before.lng) * w;
      Double sb = speedOf(before);
      Double sa = speedOf(after);
      Double mps;
      if (sb != null && sa != null) {
        mps = sb + (sa - sb) * w;
      } else if (gap > 0) {
        mps = haversine(before, after) / (gap / 1000.0);
      } else {
        mps = sb != null ? sb : sa;
      }
      if (mps == null) {
        return null;
      }
      p.accuracy = Math.max(before.accuracy, after.accuracy);
      p.speedKph = mps * 3.6;
      return p;
    }

    MotionDetector.Fix only = before != null ? before : after;
    if (only == null || Math.abs(only.t - t) > o.edgeMs) {
      return null;
    }
    Double mps = speedOf(only);
    if (mps == null) {
      return null;
    }
    Position p = new Position();
    p.lat = only.lat;
    p.lng = only.lng;
    p.accuracy = only.accuracy;
    p.speedKph = mps * 3.6;
    return p;
  }

  private static Double speedOf(MotionDetector.Fix fix) {
    if (!fix.hasSpeed || !isFinite(fix.speed) || fix.speed < 0) {
      return null;
    }
    return fix.speed;
  }

  static double haversine(MotionDetector.Fix a, MotionDetector.Fix b) {
    double earth = 6371008.8;
    double dLat = ((b.lat - a.lat) * Math.PI) / 180;
    double dLng = ((b.lng - a.lng) * Math.PI) / 180;
    double lat1 = (a.lat * Math.PI) / 180;
    double lat2 = (b.lat * Math.PI) / 180;
    double h = StrictMath.sin(dLat / 2) * StrictMath.sin(dLat / 2) +
        StrictMath.cos(lat1) * StrictMath.cos(lat2) * StrictMath.sin(dLng / 2) * StrictMath.sin(dLng / 2);
    return 2 * earth * StrictMath.asin(Math.min(1, Math.sqrt(h)));
  }

  static boolean isFinite(double v) {
    return !Double.isNaN(v) && !Double.isInfinite(v);
  }
}

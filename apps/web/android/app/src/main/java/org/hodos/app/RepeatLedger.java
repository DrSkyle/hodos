package org.hodos.app;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native port of packages/core/src/ledger.ts.
 *
 * On-device repetition ledger. A real defect is felt in the same place on
 * different trips; handling noise and one-off jolts are not. Passes are keyed by
 * a quantised cell (~11 m) and its neighbours, and only a *separate* trip (gap of
 * at least `minSeparationMs`) counts as another pass. Server-side clustering
 * stays the final authority; this just lets the phone say "I have felt this
 * before" without uploading a track.
 */
public final class RepeatLedger {

  public static final class Options {
    public double cellDeg = 1e-4;
    public long minSeparationMs = 60_000;
    public double magnitudeRatio = 0.5;
    public double boostPerPass = 0.08;
    public double maxBoost = 0.2;
    public long maxAgeMs = 90L * 86_400_000L;
  }

  private static final class Entry {
    long t;
    double magnitude;
    String kind;
  }

  private final Map<String, List<Entry>> cells = new HashMap<>();
  private final Options o;

  public RepeatLedger() {
    this(new Options());
  }

  public RepeatLedger(Options options) {
    this.o = options;
  }

  private static String key(long ix, long iy) {
    return ix + ":" + iy;
  }

  /**
   * Record the impact and return it with `repeats` set and confidence raised by
   * earlier corroborating passes. The first sight of a place is unchanged.
   */
  public MotionDetector.Impact observe(MotionDetector.Impact impact) {
    long ix = (long) Math.floor(impact.lat / o.cellDeg);
    long iy = (long) Math.floor(impact.lng / o.cellDeg);
    List<Double> passTimes = new ArrayList<>();
    for (int dx = -1; dx <= 1; dx += 1) {
      for (int dy = -1; dy <= 1; dy += 1) {
        List<Entry> entries = cells.get(key(ix + dx, iy + dy));
        if (entries == null) {
          continue;
        }
        for (Entry e : entries) {
          if (impact.t - e.t > o.maxAgeMs || !e.kind.equals(impact.kind)) {
            continue;
          }
          double hi = Math.max(e.magnitude, impact.magnitude);
          double lo = Math.min(e.magnitude, impact.magnitude);
          if (hi > 0 && lo / hi < o.magnitudeRatio) {
            continue;
          }
          if (Math.abs(impact.t - e.t) >= o.minSeparationMs) {
            passTimes.add((double) e.t);
          }
        }
      }
    }
    java.util.Collections.sort(passTimes);
    int repeats = 0;
    double lastCounted = Double.NEGATIVE_INFINITY;
    for (double pt : passTimes) {
      if (pt - lastCounted >= o.minSeparationMs) {
        repeats += 1;
        lastCounted = pt;
      }
    }

    String cellKey = key(ix, iy);
    List<Entry> list = cells.get(cellKey);
    if (list == null) {
      list = new ArrayList<>();
      cells.put(cellKey, list);
    }
    Entry entry = new Entry();
    entry.t = impact.t;
    entry.magnitude = impact.magnitude;
    entry.kind = impact.kind;
    list.add(entry);

    impact.repeats = repeats;
    if (repeats > 0) {
      double boost = Math.min(o.maxBoost, o.boostPerPass * repeats);
      impact.confidence = Math.round(Math.min(1, impact.confidence + boost) * 1000) / 1000.0;
    }
    return impact;
  }
}

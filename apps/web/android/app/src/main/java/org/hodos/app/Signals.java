package org.hodos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Native port of packages/core/src/signal.ts.
 *
 * Parity rules, because the shared goldens are exact-value assertions:
 *  - Math.sqrt only, never Math.hypot.
 *  - StrictMath for sin/cos so the biquad matches V8's fdlibm bit for bit.
 *  - No toFixed/String formatting in the algorithm path; rounding goes through
 *    round1/round2/round3 (Math.round(v * 10^n) / 10^n).
 *  - The noise floor is a fixed-bin histogram updated in O(1) per sample, with
 *    median index floor(n/2) and value 1.4826 * ((bin + 0.5) * binWidth).
 */
public final class Signals {

  public static final int FLOOR_BINS = 2048;
  public static final double FLOOR_MAX = 8;
  static final double FLOOR_BIN_WIDTH = FLOOR_MAX / FLOOR_BINS;

  private Signals() {}

  public static double median(List<Double> values) {
    if (values.isEmpty()) {
      return 0;
    }
    List<Double> sorted = new ArrayList<>(values);
    Collections.sort(sorted);
    int middle = sorted.size() / 2;
    double upper = sorted.get(middle);
    if (sorted.size() % 2 == 1) {
      return upper;
    }
    double lower = sorted.get(middle - 1);
    return (lower + upper) / 2;
  }

  public static double round3(double v) {
    return Math.round(v * 1000) / 1000.0;
  }

  public static double round2(double v) {
    return Math.round(v * 100) / 100.0;
  }

  public static double round1(double v) {
    return Math.round(v * 10) / 10.0;
  }

  public static double clamp(double value, double low, double high) {
    return Math.min(high, Math.max(low, value));
  }

  public static final class Biquad {
    public final double b0;
    public final double b1;
    public final double b2;
    public final double a1;
    public final double a2;

    Biquad(double b0, double b1, double b2, double a1, double a2) {
      this.b0 = b0;
      this.b1 = b1;
      this.b2 = b2;
      this.a1 = a1;
      this.a2 = a2;
    }
  }

  /** Second-order band-pass, centred geometrically between the two corners. */
  public static Biquad designBandpass(double lowHz, double highHz, double sampleRate) {
    double centre = Math.sqrt(lowHz * highHz);
    double w0 = (2 * Math.PI * centre) / sampleRate;
    double q = centre / (highHz - lowHz);
    double alpha = StrictMath.sin(w0) / (2 * q);
    double cosw = StrictMath.cos(w0);
    double a0 = 1 + alpha;
    return new Biquad(alpha / a0, 0, -alpha / a0, (-2 * cosw) / a0, (1 - alpha) / a0);
  }

  public static double[] filter(double[] signal, Biquad c) {
    double[] out = new double[signal.length];
    double x1 = 0;
    double x2 = 0;
    double y1 = 0;
    double y2 = 0;
    for (int i = 0; i < signal.length; i += 1) {
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

  /**
   * Band-pass that restarts its state after a gap in the sample clock. A phone
   * that stops delivering callbacks must not smear stale filter memory across
   * the hole and manufacture an impulse.
   */
  public static double[] filterSegments(double[] signal, long[] times, Biquad c, double gapMs) {
    double[] out = new double[signal.length];
    double x1 = 0;
    double x2 = 0;
    double y1 = 0;
    double y2 = 0;
    for (int i = 0; i < signal.length; i += 1) {
      if (i > 0 && (times[i] - times[i - 1]) > gapMs) {
        x1 = 0;
        x2 = 0;
        y1 = 0;
        y2 = 0;
      }
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

  private static int floorBin(double value) {
    int bin = (int) Math.floor(Math.abs(value) / FLOOR_BIN_WIDTH);
    return bin >= FLOOR_BINS ? FLOOR_BINS - 1 : bin;
  }

  /**
   * Riot-proof noise floor: the scaled median absolute deviation of a trailing
   * window, from a fixed-bin histogram updated in O(1) per sample.
   */
  public static double[] robustFloor(double[] values, int window, int stride) {
    double[] out = new double[values.length];
    int[] counts = new int[FLOOR_BINS];
    double current = 0;
    for (int i = 0; i < values.length; i += 1) {
      counts[floorBin(values[i])] += 1;
      if (i >= window) {
        counts[floorBin(values[i - window])] -= 1;
      }
      if (i % stride == 0) {
        int n = Math.min(i + 1, window);
        int target = n / 2;
        int seen = 0;
        int bin = 0;
        for (; bin < FLOOR_BINS - 1; bin += 1) {
          seen += counts[bin];
          if (seen > target) {
            break;
          }
        }
        current = 1.4826 * ((bin + 0.5) * FLOOR_BIN_WIDTH);
      }
      out[i] = current;
    }
    return out;
  }

  /**
   * Linear resample onto a uniform grid `startT + k * 1000 / rateHz`, so cadence
   * is not distorted by jittery sensor callbacks.
   */
  public static List<Double> resampleUniform(
      List<Long> times, List<Double> values, long startT, double rateHz, int count) {
    List<Double> out = new ArrayList<>(count);
    double step = 1000 / rateHz;
    int j = 0;
    for (int k = 0; k < count; k += 1) {
      double t = startT + k * step;
      while (j < times.size() - 2 && times.get(j + 1) < t) {
        j += 1;
      }
      long t0 = times.get(j);
      long t1 = j + 1 < times.size() ? times.get(j + 1) : t0;
      double v0 = values.get(j);
      double v1 = j + 1 < values.size() ? values.get(j + 1) : v0;
      if (t1 <= t0) {
        out.add(v0);
      } else {
        out.add(v0 + (v1 - v0) * clamp((t - t0) / (t1 - t0), 0, 1));
      }
    }
    return out;
  }

  public static final class Autocorr {
    public int lag;
    public double corr;
  }

  /**
   * Strongest normalised autocorrelation of a zero-mean series for lags in
   * [minLag, maxLag]. A periodic gait or pedal stroke gives a value near 1.
   */
  public static Autocorr autocorrPeak(List<Double> x, int minLag, int maxLag) {
    Autocorr out = new Autocorr();
    int n = x.size();
    double energy = 0;
    for (int i = 0; i < n; i += 1) {
      energy += x.get(i) * x.get(i);
    }
    if (energy < 1e-9 || n <= maxLag + 2) {
      return out;
    }
    double variance = energy / n;
    double bestCorr = 0;
    int bestLag = 0;
    for (int lag = minLag; lag <= maxLag; lag += 1) {
      double sum = 0;
      for (int i = 0; i + lag < n; i += 1) {
        sum += x.get(i) * x.get(i + lag);
      }
      double r = sum / (n - lag) / variance;
      if (r > bestCorr) {
        bestCorr = r;
        bestLag = lag;
      }
    }
    out.lag = bestLag;
    out.corr = bestCorr;
    return out;
  }

  /** Median inter-sample interval, in milliseconds. */
  public static double medianInterval(long[] times, double fallbackMs) {
    if (times.length < 2) {
      return fallbackMs;
    }
    List<Double> deltas = new ArrayList<>();
    for (int i = 1; i < times.length; i += 1) {
      deltas.add((double) (times[i] - times[i - 1]));
    }
    double value = median(deltas);
    return value > 0 ? value : fallbackMs;
  }
}

package org.hodos.app;

import java.util.ArrayList;
import java.util.List;

/**
 * Native port of packages/core/src/calibration.ts.
 *
 * Per-journey self-calibration. After the device has been confirmed in a moving
 * state for `learnMs`, the typical band-passed vibration level of THIS vehicle
 * on THIS mount is known. That level becomes a lower bound on the noise floor
 * for the rest of the journey, so a bus whose shudder briefly eases cannot let
 * the threshold sag and admit false impacts.
 */
public final class JourneyCalibration {

  public static final class Result {
    public boolean ready;
    public long readyAt;
    public double floor;
    public int learnedSamples;
  }

  public static final class Options {
    public long learnMs = 20000;
    public int minSamples = 200;
    /** Per-device long-run floor from earlier journeys, m/s^2 (optional; NaN = absent). */
    public double devicePriorFloor = Double.NaN;
    public double priorWeight = 0.3;
  }

  public static final Options DEFAULTS = new Options();

  private JourneyCalibration() {}

  public static Result calibrateJourney(
      double[] filtered,
      long[] times,
      MotionStateEstimator.Timeline timeline,
      Options o) {
    Result out = new Result();
    List<Double> learned = new ArrayList<>();
    long movingMs = 0;
    long readyAt = 0;
    for (int i = 0; i < filtered.length; i += 1) {
      long t = times[i];
      String state = MotionStateEstimator.stateAt(timeline, t);
      if (!MotionStateEstimator.VEHICLE.equals(state) &&
          !MotionStateEstimator.CYCLING.equals(state)) {
        continue;
      }
      if (i > 0) {
        movingMs += Math.min(500, t - times[i - 1]);
      }
      learned.add(Math.abs(filtered[i]));
      if (movingMs >= o.learnMs) {
        readyAt = t;
        break;
      }
    }
    out.learnedSamples = learned.size();
    if (readyAt == 0 || learned.size() < o.minSamples) {
      out.ready = false;
      return out;
    }
    double floor = 1.4826 * Signals.median(learned);
    if (!Double.isNaN(o.devicePriorFloor) && o.devicePriorFloor > 0) {
      floor = (1 - o.priorWeight) * floor + o.priorWeight * o.devicePriorFloor;
    }
    out.ready = true;
    out.readyAt = readyAt;
    out.floor = floor;
    return out;
  }

  /** Fold a finished journey's floor into the long-run per-device prior. */
  public static double updateDevicePrior(double prior, Result calibration) {
    if (!calibration.ready) {
      return prior;
    }
    if (Double.isNaN(prior) || prior <= 0) {
      return calibration.floor;
    }
    return 0.8 * prior + 0.2 * calibration.floor;
  }
}

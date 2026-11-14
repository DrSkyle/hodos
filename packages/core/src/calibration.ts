import { median } from "./signal";
import { stateAt, type MotionTimeline } from "./motion-state";

/**
 * Per-journey self-calibration. After the device has been confirmed in a
 * moving state for `learnMs`, the typical band-passed vibration level of THIS
 * vehicle on THIS mount is known. That level becomes a lower bound on the noise
 * floor for the rest of the journey, so a bus whose shudder briefly eases
 * cannot let the threshold sag and admit false impacts.
 */
export interface JourneyCalibration {
  ready: boolean;
  /** Epoch ms from which `floor` applies (end of the learning period). */
  readyAt: number;
  /** Robust vibration floor learned for this journey, m/s^2. */
  floor: number;
  learnedSamples: number;
}

export interface CalibrationOptions {
  learnMs: number;
  minSamples: number;
  /** Per-device long-run floor from earlier journeys, m/s^2 (optional). */
  devicePriorFloor?: number;
  /** Weight of the prior against the learned value, 0..1. */
  priorWeight: number;
}

export const DEFAULT_CALIBRATION_OPTIONS: CalibrationOptions = {
  learnMs: 20000,
  minSamples: 200,
  priorWeight: 0.3,
};

export function calibrateJourney(
  filtered: number[],
  times: number[],
  timeline: MotionTimeline,
  options: Partial<CalibrationOptions> = {},
): JourneyCalibration {
  const o: CalibrationOptions = { ...DEFAULT_CALIBRATION_OPTIONS, ...options };
  const learned: number[] = [];
  let movingMs = 0;
  let readyAt = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    const t = times[i] ?? 0;
    const state = stateAt(timeline, t);
    if (state !== "vehicle" && state !== "cycling") {
      continue;
    }
    if (i > 0) {
      movingMs += Math.min(500, t - (times[i - 1] ?? t));
    }
    learned.push(Math.abs(filtered[i] ?? 0));
    if (movingMs >= o.learnMs) {
      readyAt = t;
      break;
    }
  }
  if (readyAt === 0 || learned.length < o.minSamples) {
    return { ready: false, readyAt: 0, floor: 0, learnedSamples: learned.length };
  }
  let floor = 1.4826 * median(learned);
  if (o.devicePriorFloor !== undefined && o.devicePriorFloor > 0) {
    floor = (1 - o.priorWeight) * floor + o.priorWeight * o.devicePriorFloor;
  }
  return { ready: true, readyAt, floor, learnedSamples: learned.length };
}

/** Fold a finished journey's floor into the long-run per-device prior. */
export function updateDevicePrior(prior: number | undefined, calibration: JourneyCalibration): number | undefined {
  if (!calibration.ready) {
    return prior;
  }
  if (prior === undefined || prior <= 0) {
    return calibration.floor;
  }
  return 0.8 * prior + 0.2 * calibration.floor;
}

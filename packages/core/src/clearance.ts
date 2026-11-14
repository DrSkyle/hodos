import { haversineMeters } from "./geo";
import type { GeoFix, Hazard, Impact } from "./types";

export interface ClearanceOptions {
  /** How close a Device must travel for the visit to count as a pass. */
  passDistanceM: number;
  /** An impact within this distance confirms the hazard instead. */
  impactDistanceM: number;
  /** Fixes coarser than this (metres) are not trusted as a traversal. */
  maxFixAccuracyM: number;
  /** A pass must be at a real travelling speed, not parked or drifting. */
  minSpeedMps: number;
  maxSpeedMps: number;
  /** Two fixes near the hazard must be this far apart in time (ms) ... */
  minIntervalMs: number;
  /** ... and no further apart than this. */
  maxIntervalMs: number;
  /** ... and this far apart in space (m): the device actually moved through. */
  minDisplacementM: number;
  /** Motion samples must exist within this of each passage fix. */
  sensorWindowMs: number;
  minSensorSpanMs: number;
}

export const DEFAULT_CLEARANCE_OPTIONS: ClearanceOptions = {
  passDistanceM: 22,
  impactDistanceM: 25,
  maxFixAccuracyM: 25,
  minSpeedMps: 2.5,
  maxSpeedMps: 45,
  minIntervalMs: 500,
  maxIntervalMs: 20_000,
  minDisplacementM: 4,
  sensorWindowMs: 1500,
  minSensorSpanMs: 400,
};

function reliableMovingFix(fix: GeoFix, o: ClearanceOptions): boolean {
  return (
    fix.t > 0 &&
    fix.speed !== null &&
    Number.isFinite(fix.lat) &&
    Math.abs(fix.lat) <= 90 &&
    Number.isFinite(fix.lng) &&
    Math.abs(fix.lng) <= 180 &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    fix.accuracy <= o.maxFixAccuracyM &&
    Number.isFinite(fix.speed) &&
    fix.speed >= o.minSpeedMps &&
    fix.speed <= o.maxSpeedMps
  );
}

/** True when sorted motion-sample times span at least `minSensorSpanMs` within `sensorWindowMs` of `at`. */
function sensorCoveredAt(times: number[], at: number, o: ClearanceOptions): boolean {
  if (at <= 0) return false;
  const from = at - o.sensorWindowMs;
  const to = at + o.sensorWindowMs;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < from) lo = mid + 1;
    else hi = mid;
  }
  let first = -1;
  for (let i = lo; i < times.length; i += 1) {
    const t = times[i]!;
    if (t > to) break;
    if (first < 0) first = t;
    else if (t - first >= o.minSensorSpanMs) return true;
  }
  return false;
}

/**
 * Hazards a Device travelled past without feeling anything.
 *
 * This is the negative observation that lets the map heal itself, so it has to
 * be hard to get wrong: one GPS point beside a hazard is NOT evidence of a
 * clear road (the phone may be parked, GPS may drift, the sensor may have
 * stopped). Two distinct, accurate, moving fixes near the hazard are required,
 * the device must have physically moved between them, and - when `motionTimes`
 * (sorted epoch ms of motion samples) is supplied - accelerometer coverage must
 * exist at both. Only the conclusion is uploaded, never the track.
 * Same rules as the Android `MotionDetector.passedHazards`.
 */
export function passedHazards<T extends Hazard>(
  fixes: GeoFix[],
  hazards: T[],
  impacts: Impact[],
  options: Partial<ClearanceOptions> = {},
  motionTimes?: number[],
): T[] {
  const o: ClearanceOptions = { ...DEFAULT_CLEARANCE_OPTIONS, ...options };
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  const times = motionTimes === undefined ? undefined : [...motionTimes].sort((a, b) => a - b);
  const passed: T[] = [];
  for (const hazard of hazards) {
    if (
      !Number.isFinite(hazard.lat) ||
      !Number.isFinite(hazard.lng) ||
      Math.abs(hazard.lat) > 90 ||
      Math.abs(hazard.lng) > 180
    ) {
      continue;
    }
    let previous: GeoFix | null = null;
    let travelled = false;
    for (const fix of sorted) {
      if (!reliableMovingFix(fix, o) || haversineMeters(fix, hazard) > o.passDistanceM) {
        continue;
      }
      if (previous !== null) {
        const elapsed = fix.t - previous.t;
        if (
          elapsed >= o.minIntervalMs &&
          elapsed <= o.maxIntervalMs &&
          haversineMeters(previous, fix) >= o.minDisplacementM &&
          (times === undefined || (sensorCoveredAt(times, previous.t, o) && sensorCoveredAt(times, fix.t, o)))
        ) {
          travelled = true;
          break;
        }
      }
      previous = fix;
    }
    if (!travelled) {
      continue;
    }
    const felt = impacts.some((impact) => haversineMeters(impact, hazard) <= o.impactDistanceM);
    if (!felt) {
      passed.push(hazard);
    }
  }
  return passed;
}

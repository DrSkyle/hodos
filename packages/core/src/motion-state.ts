import { haversineMeters } from "./geo";
import { autocorrPeak, median, resampleUniform } from "./signal";
import type { GeoFix, MotionSample, MotionState } from "./types";

/**
 * Motion-state estimation by evidence fusion.
 *
 * No single signal decides anything. Each analysis window yields independent
 * observations -
 *   1. motion energy       (robust per-second RMS of linear acceleration)
 *   2. gait / pedal cadence (autocorrelation of acceleration magnitude,
 *                            orientation independent, no platform step sensor)
 *   3. grip stability      (how much the gravity vector wanders, plus gyro)
 *   4. engine-band energy  (high-frequency vibration a running engine adds)
 *   5. GPS speed and displacement (and whether the two agree)
 * - and a state is only returned when the observations that define it agree.
 * Anything ambiguous or contradictory is "unknown", which can never emit.
 */

export interface MotionStateOptions {
  windowMs: number;
  hopMs: number;
  /** Consecutive agreeing hops required before the stable state changes. */
  dwellHops: number;
  minSamples: number;
  /** Fraction of the window the samples must actually span. */
  minSpanFraction: number;
  resampleHz: number;
  /** Step cadence band, Hz (heel strikes: 1.4-2.8). */
  stepMinHz: number;
  stepMaxHz: number;
  /** Pedal cadence band, Hz. */
  pedalMinHz: number;
  pedalMaxHz: number;
  stepCorr: number;
  pedalCorr: number;
  /** Walking needs real body motion, m/s^2 RMS. */
  walkMinRms: number;
  /** Below this RMS (and no GPS speed) the phone is at rest. */
  stillMaxRms: number;
  /** A moving vehicle always has at least this much vibration. */
  vehicleMinRms: number;
  /** High-frequency (first-difference) RMS that marks a running engine. */
  engineHfRms: number;
  /** Gravity-vector wander above this (deg per second-block) means in hand. */
  handDriftDeg: number;
  /** Median gyro magnitude above this (deg/s) means in hand. */
  handGyroDps: number;
  walkMaxKph: number;
  minMovingKph: number;
  cyclingMaxKph: number;
  minGpsFixes: number;
  maxFixAccuracyM: number;
}

export const DEFAULT_MOTION_OPTIONS: MotionStateOptions = {
  windowMs: 6000,
  hopMs: 1000,
  dwellHops: 2,
  minSamples: 40,
  minSpanFraction: 0.6,
  resampleHz: 50,
  stepMinHz: 1.4,
  stepMaxHz: 2.8,
  pedalMinHz: 0.7,
  pedalMaxHz: 1.6,
  stepCorr: 0.55,
  pedalCorr: 0.3,
  walkMinRms: 0.5,
  stillMaxRms: 0.15,
  vehicleMinRms: 0.1,
  engineHfRms: 0.12,
  handDriftDeg: 12,
  handGyroDps: 25,
  walkMaxKph: 9,
  minMovingKph: 5,
  cyclingMaxKph: 32,
  minGpsFixes: 3,
  maxFixAccuracyM: 50,
};

export interface MotionEvidence {
  samples: number;
  spanMs: number;
  /** Robust motion energy, m/s^2. */
  motionRms: number;
  /** High-frequency energy, m/s^2. */
  hfRms: number;
  stepCorr: number;
  stepHz: number;
  pedalCorr: number;
  pedalHz: number;
  /** Median change of gravity direction between one-second blocks, degrees. */
  gravityDriftDeg: number;
  /** Median gyro magnitude, deg/s; null when the device reports none. */
  gyroRms: number | null;
  gpsKph: number | null;
  gpsFixes: number;
  /** Reported speed and displacement speed disagree. */
  gpsConflict: boolean;
}

export interface MotionSpan {
  t: number;
  raw: MotionState;
  state: MotionState;
  evidence: MotionEvidence;
}

export interface MotionTimeline {
  startT: number;
  hopMs: number;
  spans: MotionSpan[];
}

export function emitsImpacts(state: MotionState): boolean {
  return state === "vehicle" || state === "cycling" || state === "walking";
}

/**
 * Angle between two vectors, in degrees, from the chord between their unit
 * vectors (sqrt only, so TS and Java agree to the last bit; within ~2% of the
 * true angle up to 40 degrees, which is all the grip test needs).
 */
function angleDeg(a: number[], b: number[]): number {
  const na = Math.sqrt(a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!);
  const nb = Math.sqrt(b[0]! * b[0]! + b[1]! * b[1]! + b[2]! * b[2]!);
  if (na < 1e-9 || nb < 1e-9) {
    return 0;
  }
  const dx = a[0]! / na - b[0]! / nb;
  const dy = a[1]! / na - b[1]! / nb;
  const dz = a[2]! / na - b[2]! / nb;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * (180 / Math.PI);
}

function gpsEvidence(
  fixes: GeoFix[],
  from: number,
  to: number,
  maxAccuracyM: number,
): { kph: number | null; count: number; conflict: boolean } {
  const valid: GeoFix[] = [];
  for (const fix of fixes) {
    if (fix.t < from || fix.t > to) {
      continue;
    }
    if (
      !Number.isFinite(fix.lat) ||
      !Number.isFinite(fix.lng) ||
      Math.abs(fix.lat) > 90 ||
      Math.abs(fix.lng) > 180 ||
      !Number.isFinite(fix.accuracy) ||
      fix.accuracy < 0 ||
      fix.accuracy > maxAccuracyM
    ) {
      continue;
    }
    valid.push(fix);
  }
  if (valid.length === 0) {
    return { kph: null, count: 0, conflict: false };
  }
  const speeds: number[] = [];
  for (const fix of valid) {
    if (fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 && fix.speed <= 70) {
      speeds.push(fix.speed * 3.6);
    }
  }
  const reported = speeds.length >= 2 ? median(speeds) : null;

  let displacement: number | null = null;
  const first = valid[0]!;
  const last = valid[valid.length - 1]!;
  const elapsed = (last.t - first.t) / 1000;
  if (valid.length >= 2 && elapsed >= 3) {
    const distance = haversineMeters(first, last);
    if (distance <= elapsed * 45 + 30) {
      displacement = (distance / elapsed) * 3.6;
    }
  }

  let conflict = false;
  if (reported !== null && displacement !== null) {
    conflict = Math.abs(reported - displacement) > Math.max(4, 0.5 * Math.max(reported, displacement));
  }
  const kph = reported ?? displacement;
  return { kph, count: valid.length, conflict };
}

/** Observations for the window [from, to]. `samples` must be time-ordered. */
export function computeEvidence(
  samples: MotionSample[],
  fixes: GeoFix[],
  from: number,
  to: number,
  options: Partial<MotionStateOptions> = {},
): MotionEvidence {
  const o: MotionStateOptions = { ...DEFAULT_MOTION_OPTIONS, ...options };
  const win: MotionSample[] = [];
  for (const s of samples) {
    if (s.t >= from && s.t <= to) {
      win.push(s);
    }
  }
  const gps = gpsEvidence(fixes, from, to, o.maxFixAccuracyM);
  const empty: MotionEvidence = {
    samples: win.length,
    spanMs: 0,
    motionRms: 0,
    hfRms: 0,
    stepCorr: 0,
    stepHz: 0,
    pedalCorr: 0,
    pedalHz: 0,
    gravityDriftDeg: 0,
    gyroRms: null,
    gpsKph: gps.kph,
    gpsFixes: gps.count,
    gpsConflict: gps.conflict,
  };
  if (win.length < 2) {
    return empty;
  }
  const t0 = win[0]!.t;
  const spanMs = win[win.length - 1]!.t - t0;
  empty.spanMs = spanMs;

  // One-second blocks: mean vector (gravity direction), residual RMS, gyro RMS.
  const blocks = new Map<number, { n: number; sx: number; sy: number; sz: number; items: MotionSample[] }>();
  for (const s of win) {
    const key = Math.floor((s.t - t0) / 1000);
    let b = blocks.get(key);
    if (b === undefined) {
      b = { n: 0, sx: 0, sy: 0, sz: 0, items: [] };
      blocks.set(key, b);
    }
    b.n += 1;
    b.sx += s.ax;
    b.sy += s.ay;
    b.sz += s.az;
    b.items.push(s);
  }
  const keys = [...blocks.keys()].sort((a, b) => a - b);
  const blockRms: number[] = [];
  const blockGyro: number[] = [];
  const blockHf: number[] = [];
  const means: number[][] = [];
  let hasGyro = false;
  for (const key of keys) {
    const b = blocks.get(key)!;
    if (b.n < 5) {
      continue;
    }
    const mx = b.sx / b.n;
    const my = b.sy / b.n;
    const mz = b.sz / b.n;
    let ss = 0;
    let gs = 0;
    let gn = 0;
    for (const s of b.items) {
      const dx = s.ax - mx;
      const dy = s.ay - my;
      const dz = s.az - mz;
      ss += dx * dx + dy * dy + dz * dz;
      if (s.gx !== undefined && s.gy !== undefined && s.gz !== undefined) {
        gs += s.gx * s.gx + s.gy * s.gy + s.gz * s.gz;
        gn += 1;
      }
    }
    blockRms.push(Math.sqrt(ss / b.n));
    let hs = 0;
    for (let q = 1; q < b.items.length; q += 1) {
      const m1 = b.items[q]!;
      const m0 = b.items[q - 1]!;
      const d =
        Math.sqrt(m1.ax * m1.ax + m1.ay * m1.ay + m1.az * m1.az) -
        Math.sqrt(m0.ax * m0.ax + m0.ay * m0.ay + m0.az * m0.az);
      hs += d * d;
    }
    blockHf.push(Math.sqrt(hs / Math.max(1, b.items.length - 1) / 2));
    means.push([mx, my, mz]);
    if (gn > 0) {
      hasGyro = true;
      blockGyro.push(Math.sqrt(gs / gn));
    }
  }
  const drifts: number[] = [];
  for (let i = 1; i < means.length; i += 1) {
    drifts.push(angleDeg(means[i - 1]!, means[i]!));
  }

  // Acceleration magnitude, resampled uniform, zero mean: cadence and HF energy.
  const times = win.map((s) => s.t);
  const mag = win.map((s) => Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az));
  const count = Math.max(8, Math.floor((spanMs / 1000) * o.resampleHz));
  const uniform = resampleUniform(times, mag, t0, o.resampleHz, count);
  let mean = 0;
  for (const v of uniform) {
    mean += v;
  }
  mean /= uniform.length;
  const centred = uniform.map((v) => v - mean);
  // Winsorise at 5 robust sigmas so a single pothole cannot dominate (or erase)
  // the periodicity of the underlying gait / pedal stroke.
  const sigma = 1.4826 * median(centred.map((v) => Math.abs(v)));
  const clip = 5 * Math.max(sigma, 0.05);
  const zero = centred.map((v) => Math.max(-clip, Math.min(clip, v)));

  const stepLo = Math.round(o.resampleHz / o.stepMaxHz);
  const stepHi = Math.round(o.resampleHz / o.stepMinHz);
  const step = autocorrPeak(zero, stepLo, stepHi);
  const pedalLo = Math.round(o.resampleHz / o.pedalMaxHz);
  const pedalHi = Math.round(o.resampleHz / o.pedalMinHz);
  const pedal = autocorrPeak(zero, pedalLo, pedalHi);

  return {
    samples: win.length,
    spanMs,
    motionRms: median(blockRms),
    hfRms: median(blockHf),
    stepCorr: step.corr,
    stepHz: step.lag > 0 ? o.resampleHz / step.lag : 0,
    pedalCorr: pedal.corr,
    pedalHz: pedal.lag > 0 ? o.resampleHz / pedal.lag : 0,
    gravityDriftDeg: median(drifts),
    gyroRms: hasGyro ? median(blockGyro) : null,
    gpsKph: gps.kph,
    gpsFixes: gps.count,
    gpsConflict: gps.conflict,
  };
}

/** Fraction of an entry threshold that is enough to *stay* in the state you are already in. */
export const HOLD_FACTOR = 0.65;

/**
 * Decide a state from one window of evidence. Pure and total.
 * `previous` is the stable state so far: the discriminating threshold of that
 * state is relaxed to HOLD_FACTOR, a Schmitt trigger, so marginal evidence
 * cannot make the state chatter, while entering it still takes full evidence.
 */
export function classifyEvidence(
  ev: MotionEvidence,
  options: Partial<MotionStateOptions> = {},
  previous: MotionState = "unknown",
): MotionState {
  const o: MotionStateOptions = { ...DEFAULT_MOTION_OPTIONS, ...options };
  if (ev.samples < o.minSamples || ev.spanMs < o.windowMs * o.minSpanFraction) {
    return "unknown";
  }
  if (ev.gpsConflict) {
    return "unknown";
  }
  const gps = ev.gpsKph;

  // Gait: periodic body motion with energy, and no contradicting fast GPS.
  const gait =
    ev.stepCorr >= o.stepCorr * (previous === "walking" ? HOLD_FACTOR : 1) && ev.motionRms >= o.walkMinRms;
  if (gait && (gps === null || gps <= o.walkMaxKph)) {
    return "walking";
  }

  // Grip: a wandering gravity vector or real rotation = phone is being held/moved.
  const handled =
    ev.gravityDriftDeg >= o.handDriftDeg || (ev.gyroRms !== null && ev.gyroRms >= o.handGyroDps);
  if (handled) {
    return "in_hand";
  }

  // Locomotion: GPS motion must be corroborated by body vibration.
  if (gps !== null && gps >= o.minMovingKph && ev.gpsFixes >= o.minGpsFixes) {
    if (ev.motionRms < o.vehicleMinRms) {
      return "unknown";
    }
    if (ev.hfRms >= o.engineHfRms * (previous === "vehicle" ? HOLD_FACTOR : 1)) {
      return "vehicle";
    }
    if (gps <= o.cyclingMaxKph) {
      return ev.pedalCorr >= o.pedalCorr * (previous === "cycling" ? HOLD_FACTOR : 1) ? "cycling" : "unknown";
    }
    return "vehicle";
  }

  if (ev.motionRms < o.stillMaxRms && (gps === null || gps < 1.5)) {
    return "still";
  }
  return "unknown";
}

/**
 * State per one-second hop across a recording, with dwell hysteresis: the
 * stable state only changes after `dwellHops` consecutive windows agree, so a
 * single odd window cannot flip the device into or out of a state.
 */
export function estimateMotionTimeline(
  samples: MotionSample[],
  fixes: GeoFix[],
  options: Partial<MotionStateOptions> = {},
): MotionTimeline {
  const o: MotionStateOptions = { ...DEFAULT_MOTION_OPTIONS, ...options };
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const sortedFixes = [...fixes].sort((a, b) => a.t - b.t);
  if (ordered.length === 0) {
    return { startT: 0, hopMs: o.hopMs, spans: [] };
  }
  const startT = ordered[0]!.t;
  const endT = ordered[ordered.length - 1]!.t;
  const spans: MotionSpan[] = [];
  let stable: MotionState = "unknown";
  let candidate: MotionState | null = null;
  let streak = 0;
  for (let c = startT; c <= endT + o.hopMs; c += o.hopMs) {
    const ev = computeEvidence(ordered, sortedFixes, c - o.windowMs / 2, c + o.windowMs / 2, o);
    const raw = classifyEvidence(ev, o, stable);
    if (raw === stable) {
      candidate = null;
      streak = 0;
    } else if (raw === candidate) {
      streak += 1;
    } else {
      candidate = raw;
      streak = 1;
    }
    if (candidate !== null && streak >= o.dwellHops) {
      stable = candidate;
      candidate = null;
      streak = 0;
    }
    spans.push({ t: c, raw, state: stable, evidence: ev });
  }
  return { startT, hopMs: o.hopMs, spans };
}

export function stateAt(timeline: MotionTimeline, t: number): MotionState {
  if (timeline.spans.length === 0) {
    return "unknown";
  }
  const index = Math.round((t - timeline.startT) / timeline.hopMs);
  if (index < 0 || index >= timeline.spans.length) {
    return "unknown";
  }
  return timeline.spans[index]!.state;
}

export interface JourneyDecision {
  moving: boolean;
  state: MotionState;
  confidence: number;
  reason: string;
  evidence: MotionEvidence;
}

/**
 * Is a road-recording journey under way right now? The latest raw window must
 * classify as vehicle or cycling, i.e. motion energy, GPS speed/displacement
 * and a stable grip all agree. Never true on vibration alone, GPS alone, or
 * with no GPS.
 */
export function decideJourney(
  samples: MotionSample[],
  fixes: GeoFix[],
  now: number,
  options: Partial<MotionStateOptions> = {},
): JourneyDecision {
  const o: MotionStateOptions = { ...DEFAULT_MOTION_OPTIONS, ...options };
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const ev = computeEvidence(ordered, fixes, now - o.windowMs, now, o);
  const state = classifyEvidence(ev, { ...o, minSpanFraction: o.minSpanFraction });
  const moving = state === "vehicle" || state === "cycling";
  let agreeing = 0;
  if (ev.motionRms >= o.vehicleMinRms) agreeing += 1;
  if (ev.gpsKph !== null && ev.gpsKph >= o.minMovingKph && ev.gpsFixes >= o.minGpsFixes) agreeing += 1;
  if (ev.hfRms >= o.engineHfRms || ev.pedalCorr >= o.pedalCorr) agreeing += 1;
  if (ev.gravityDriftDeg < o.handDriftDeg) agreeing += 1;
  return {
    moving,
    state,
    confidence: moving ? Math.round((agreeing / 4) * 1000) / 1000 : 0,
    reason: moving ? "fused:" + state : "not-moving:" + state,
    evidence: ev,
  };
}

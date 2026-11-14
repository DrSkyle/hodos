import { calibrateJourney } from "./calibration";
import { classify, DEFAULT_CLASSIFY_OPTIONS, type ClassifyOptions } from "./classify";
import { extractFeatures, type ResidualSeries } from "./features";
import {
  emitsImpacts,
  estimateMotionTimeline,
  stateAt,
  type MotionStateOptions,
} from "./motion-state";
import { placeAt, sanitizeFixes, type PlacementOptions } from "./placement";
import {
  clamp,
  designBandpass,
  filterSegments,
  median,
  medianInterval,
  robustFloor,
  round2,
  round3,
} from "./signal";
import type { GeoFix, Impact, MotionSample, MotionState, Severity, TravelMode } from "./types";

export interface ModeOptions {
  /** Impact magnitude (m/s^2) that always passes, however quiet the road. */
  absoluteFloor: number;
  /** Multiple of the rolling noise floor that must be exceeded. */
  noiseK: number;
  /** Below this ground speed (km/h) an impact in this mode is ignored. */
  minSpeedKph: number;
  /** Above this ground speed (km/h) the mode itself is implausible and impacts are ignored. */
  maxSpeedKph: number;
}

export interface DetectOptions extends ClassifyOptions {
  bandLowHz: number;
  bandHighHz: number;
  /** Window (ms) over which the noise floor is estimated. */
  noiseWindowMs: number;
  /** Minimum gap (ms) between accepted impacts. */
  debounceMs: number;
  /** Maximum time (ms) between an impact and its nearest position fix. */
  maxFixAgeMs: number;
  /** Impacts whose nearest fix is coarser than this (metres) are discarded. */
  maxFixAccuracyM: number;
  vehicle: ModeOptions;
  pedestrian: ModeOptions;
  cycling: ModeOptions;
  /** Cycling impacts are capped at this severity and are never labelled potholes. */
  cyclingMaxSeverity: Severity;
  /** Confidence multiplier for cycling impacts (a bicycle is a noisy road sensor). */
  cyclingConfidenceScale: number;
  /** Motion-state estimator tuning. */
  motion: Partial<MotionStateOptions>;
  /** Placement / fix-trust tuning. */
  placement: Partial<PlacementOptions>;
  /** Time (ms) a device must be confirmed moving before its journey is calibrated. */
  learnMs: number;
  /** Long-run floor for this device from earlier journeys, m/s^2. */
  devicePriorFloor?: number;
  /** Fraction of the journey-calibrated floor applied as a lower bound. */
  calibrationFloorShare: number;
  /** A gap in the sample clock above this (ms) restarts the filter. */
  gapResetMs: number;
  /** At or above this speed (km/h) the Device is treated as a vehicle. */
  walkingMaxKph: number;
  /** Speed (km/h) at which impact gain is 1. */
  speedReferenceKph: number;
  /** Speed-normalised magnitude at which an impact becomes moderate. */
  moderateNormalised: number;
  /** Speed-normalised magnitude at which an impact becomes severe. */
  severeNormalised: number;
  /** Fraction of the threshold at which an event is considered over. */
  releaseFraction: number;
  /** Per-sample coefficient of the gravity low-pass filter. */
  gravityAlpha: number;
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = {
  ...DEFAULT_CLASSIFY_OPTIONS,
  bandLowHz: 0.5,
  bandHighHz: 6,
  noiseWindowMs: 2000,
  debounceMs: 1500,
  maxFixAgeMs: 3000,
  maxFixAccuracyM: 50,
  // Vehicle state is itself the gate (it needs sustained, agreeing evidence),
  // so the speed floor only has to rule out a parked or crawling device.
  vehicle: { absoluteFloor: 1.6, noiseK: 4, minSpeedKph: 5, maxSpeedKph: 220 },
  pedestrian: { absoluteFloor: 0.9, noiseK: 4.5, minSpeedKph: 1, maxSpeedKph: 12 },
  cycling: { absoluteFloor: 1.3, noiseK: 3.5, minSpeedKph: 5, maxSpeedKph: 55 },
  cyclingMaxSeverity: 1,
  cyclingConfidenceScale: 0.75,
  motion: {},
  placement: {},
  learnMs: 20000,
  calibrationFloorShare: 0.8,
  gapResetMs: 250,
  walkingMaxKph: 10,
  speedReferenceKph: 35,
  moderateNormalised: 6,
  severeNormalised: 12,
  releaseFraction: 0.5,
  gravityAlpha: 0.02,
};

export function residuals(samples: MotionSample[], alpha: number): ResidualSeries {
  const first = samples[0];
  if (first === undefined) {
    return { times: [], vertical: [], lateral: [] };
  }
  let gx = first.ax;
  let gy = first.ay;
  let gz = first.az;
  const times: number[] = [];
  const vertical: number[] = [];
  const lateral: number[] = [];
  const gyro: number[] = [];
  const yaw: number[] = [];
  let hasGyro = false;
  for (const sample of samples) {
    gx += alpha * (sample.ax - gx);
    gy += alpha * (sample.ay - gy);
    gz += alpha * (sample.az - gz);
    const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const hx = sample.ax - gx;
    const hy = sample.ay - gy;
    const hz = sample.az - gz;
    const v = (hx * gx + hy * gy + hz * gz) / gmag;
    const hmag2 = hx * hx + hy * hy + hz * hz;
    times.push(sample.t);
    vertical.push(v);
    lateral.push(Math.sqrt(Math.max(0, hmag2 - v * v)));
    if (sample.gx !== undefined && sample.gy !== undefined && sample.gz !== undefined) {
      hasGyro = true;
      gyro.push(Math.sqrt(sample.gx * sample.gx + sample.gy * sample.gy + sample.gz * sample.gz));
      yaw.push((sample.gx * gx + sample.gy * gy + sample.gz * gz) / gmag);
    } else {
      gyro.push(0);
      yaw.push(0);
    }
  }
  return hasGyro ? { times, vertical, lateral, gyro, yaw } : { times, vertical, lateral };
}

/**
 * Autonomous self-calibrating threshold using the rolling MAD envelope (floorVal).
 * Dynamically rejects continuous chassis shudder (heavy diesel buses, stiff suspensions)
 * without manual configuration while preserving sensitivity on smooth pavement.
 */
export function adaptiveThreshold(mode: TravelMode, modeCfg: ModeOptions, floorVal: number): number {
  const isVehicle = mode === "vehicle";
  const effectiveFloorAbs = isVehicle
    ? Math.max(modeCfg.absoluteFloor, 1.35 * floorVal)
    : modeCfg.absoluteFloor;
  const effectiveK = isVehicle
    ? modeCfg.noiseK + Math.min(1.0, Math.max(0.0, (floorVal - 0.6) * 0.5))
    : modeCfg.noiseK;
  return Math.max(effectiveFloorAbs, effectiveK * floorVal);
}

/**
 * Coarse travel mode from fix speeds alone. Returns null when there is no
 * usable speed: no speed evidence is NOT vehicle evidence. Retained for
 * callers that only have fixes; detection itself uses the fused motion state.
 */
export function resolveMode(fixes: GeoFix[], walkingMaxKph: number): TravelMode | null {
  const speeds = fixes
    .map((fix) => fix.speed)
    .filter((speed): speed is number => speed !== null && Number.isFinite(speed))
    .map((speed) => speed * 3.6);
  if (speeds.length === 0) {
    return null;
  }
  return median(speeds) >= walkingMaxKph ? "vehicle" : "pedestrian";
}

function modeOf(state: MotionState): TravelMode | null {
  switch (state) {
    case "vehicle":
      return "vehicle";
    case "cycling":
      return "cycling";
    case "walking":
      return "pedestrian";
    default:
      return null;
  }
}

function severityOf(normalised: number, cfg: DetectOptions): Severity {
  if (normalised >= cfg.severeNormalised) {
    return 3;
  }
  if (normalised >= cfg.moderateNormalised) {
    return 2;
  }
  return 1;
}

/**
 * Detect road impacts from a window of motion samples and position fixes.
 *
 * Stage order, and what each stage refuses:
 *  1. Motion state (motion-state.ts): vehicle / cycling / walking only, decided
 *     from agreeing energy, cadence, grip and GPS evidence. still, in_hand and
 *     unknown never reach the detector.
 *  2. Vertical residual -> 0.5-6 Hz band-pass (restarted across clock gaps).
 *  3. Rolling MAD noise floor, lower-bounded by the per-journey calibration.
 *  4. Event walk: threshold crossing -> true peak -> release.
 *  5. Placement: an impact needs a credible road position (interpolated between
 *     trusted fixes; none inside a GPS gap) and a plausible speed for its mode.
 *  6. Features + classify (soft lateral / handling / broadband penalties).
 */
export function detectImpacts(
  samples: MotionSample[],
  fixes: GeoFix[],
  options: Partial<DetectOptions> = {},
): Impact[] {
  const cfg: DetectOptions = { ...DEFAULT_DETECT_OPTIONS, ...options };
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  if (ordered.length === 0) {
    return [];
  }
  const placementCfg: Partial<PlacementOptions> = {
    maxFixAccuracyM: cfg.maxFixAccuracyM,
    maxFixAgeMs: cfg.maxFixAgeMs,
    ...cfg.placement,
  };
  const trusted = sanitizeFixes(fixes, placementCfg);
  const timeline = estimateMotionTimeline(ordered, trusted, cfg.motion);

  const series = residuals(ordered, cfg.gravityAlpha);
  const intervalMs = medianInterval(series.times, 20);
  const sampleRate = 1000 / Math.max(1, intervalMs);
  const coefficients = designBandpass(cfg.bandLowHz, cfg.bandHighHz, sampleRate);
  const filtered = filterSegments(series.vertical, series.times, coefficients, cfg.gapResetMs);
  const windowSamples = Math.max(5, Math.round(cfg.noiseWindowMs / Math.max(1, intervalMs)));
  const stride = Math.max(1, Math.round(windowSamples / 20));
  const floor = robustFloor(filtered, windowSamples, stride);
  const calibration = calibrateJourney(filtered, series.times, timeline, {
    learnMs: cfg.learnMs,
    devicePriorFloor: cfg.devicePriorFloor,
  });
  const span = Math.max(2, Math.round(250 / Math.max(1, intervalMs)));

  const floorAt = (index: number): number => {
    const rolling = floor[index] ?? 0;
    if (calibration.ready && (series.times[index] ?? 0) >= calibration.readyAt) {
      return Math.max(rolling, cfg.calibrationFloorShare * calibration.floor);
    }
    return rolling;
  };

  const impacts: Impact[] = [];
  let lastEmit = Number.NEGATIVE_INFINITY;
  let i = 0;

  while (i < ordered.length) {
    const state = stateAt(timeline, series.times[i] ?? 0);
    const mode = emitsImpacts(state) ? modeOf(state) : null;
    if (mode === null) {
      i += 1;
      continue;
    }
    const modeCfg = cfg[mode];
    const threshold = adaptiveThreshold(mode, modeCfg, floorAt(i));
    if (Math.abs(filtered[i] ?? 0) < threshold) {
      i += 1;
      continue;
    }
    let peakIndex = i;
    let j = i;
    while (j < ordered.length) {
      const t = adaptiveThreshold(mode, modeCfg, floorAt(j));
      if (Math.abs(filtered[j] ?? 0) < t * cfg.releaseFraction) {
        break;
      }
      if (Math.abs(filtered[j] ?? 0) > Math.abs(filtered[peakIndex] ?? 0)) {
        peakIndex = j;
      }
      j += 1;
    }
    i = Math.max(j, i + 1);

    const peakTime = series.times[peakIndex] ?? 0;
    if (peakTime - lastEmit < cfg.debounceMs) {
      continue;
    }
    // The mode must still hold at the instant of the peak.
    if (modeOf(stateAt(timeline, peakTime)) !== mode) {
      continue;
    }

    const place = placeAt(trusted, peakTime, placementCfg);
    if (place === null) {
      continue;
    }
    const speedKph = place.speedKph;
    if (speedKph < modeCfg.minSpeedKph || speedKph > modeCfg.maxSpeedKph) {
      continue;
    }

    const features = extractFeatures(series, peakIndex, span, span, filtered);
    const classification = classify(features, cfg);
    if (classification === null) {
      continue;
    }

    const snr = clamp(features.peak / Math.max(floorAt(peakIndex), 0.1) / 8, 0, 1);
    const accuracyFactor = clamp(1 - place.accuracy / 40, 0, 1);
    let confidence = round3(
      clamp(0.55 * classification.score + 0.3 * snr + 0.15 * accuracyFactor, 0, 1),
    );

    const gain = clamp(speedKph / cfg.speedReferenceKph, 0.6, 1.8);
    const normalised = round2(features.peak / gain);
    let severity = severityOf(normalised, cfg);
    let kind = classification.kind;
    if (mode === "cycling") {
      // A bicycle's rear/front wheel and rider are not a calibrated road sensor.
      severity = Math.min(severity, cfg.cyclingMaxSeverity) as Severity;
      if (kind === "pothole") {
        kind = "rough_pavement";
      }
      confidence = round3(confidence * cfg.cyclingConfidenceScale);
    }

    impacts.push({
      t: peakTime,
      lat: place.lat,
      lng: place.lng,
      accuracy: place.accuracy,
      speedKph,
      magnitude: features.peak,
      normalised,
      severity,
      kind,
      confidence,
      mode,
      features,
      motionState: state,
    });
    lastEmit = peakTime;
  }

  return impacts;
}

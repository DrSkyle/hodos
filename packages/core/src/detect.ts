import { classify, DEFAULT_CLASSIFY_OPTIONS, type ClassifyOptions } from "./classify";
import { extractFeatures, type ResidualSeries } from "./features";
import { clamp, designBandpass, filter, median, medianInterval, robustFloor } from "./signal";
import type { GeoFix, Impact, MotionSample, Severity, TravelMode } from "./types";

export interface ModeOptions {
  /** Impact magnitude (m/s^2) that always passes, however quiet the road. */
  absoluteFloor: number;
  /** Multiple of the rolling noise floor that must be exceeded. */
  noiseK: number;
  /** Below this ground speed (km/h) an impact in this mode is ignored. */
  minSpeedKph: number;
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
  vehicle: { absoluteFloor: 1.6, noiseK: 3, minSpeedKph: 12 },
  pedestrian: { absoluteFloor: 0.9, noiseK: 4.5, minSpeedKph: 1 },
  walkingMaxKph: 10,
  speedReferenceKph: 35,
  moderateNormalised: 6,
  severeNormalised: 12,
  releaseFraction: 0.5,
  gravityAlpha: 0.02,
};

function residuals(samples: MotionSample[], alpha: number): ResidualSeries {
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
  for (const sample of samples) {
    gx += alpha * (sample.ax - gx);
    gy += alpha * (sample.ay - gy);
    gz += alpha * (sample.az - gz);
    const gmag = Math.hypot(gx, gy, gz) || 1;
    const hx = sample.ax - gx;
    const hy = sample.ay - gy;
    const hz = sample.az - gz;
    const v = (hx * gx + hy * gy + hz * gz) / gmag;
    const hmag = Math.hypot(hx, hy, hz);
    times.push(sample.t);
    vertical.push(v);
    lateral.push(Math.sqrt(Math.max(0, hmag * hmag - v * v)));
  }
  return { times, vertical, lateral };
}

/** The Device is a vehicle when it is moving at vehicle speed. */
export function resolveMode(fixes: GeoFix[], walkingMaxKph: number): TravelMode {
  const speeds = fixes
    .map((fix) => fix.speed)
    .filter((speed): speed is number => speed !== null && Number.isFinite(speed))
    .map((speed) => speed * 3.6);
  if (speeds.length === 0) {
    return "vehicle";
  }
  return median(speeds) >= walkingMaxKph ? "vehicle" : "pedestrian";
}

function nearestFix(fixes: GeoFix[], t: number, maxAgeMs: number): GeoFix | null {
  let best: GeoFix | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const fix of fixes) {
    const delta = Math.abs(fix.t - t);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = fix;
    }
  }
  if (best === null || bestDelta > maxAgeMs) {
    return null;
  }
  return best;
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
 * The vertical residual is band-passed to the band road impacts live in, a
 * rolling noise floor sets a threshold that adapts to the road and the vehicle,
 * and each candidate event is characterised and classified before it is kept.
 * Because the threshold rises with whatever is regular in the signal, a
 * pedestrian's footfalls lift the floor and suppress themselves.
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

  const series = residuals(ordered, cfg.gravityAlpha);
  const intervalMs = medianInterval(series.times, 20);
  const sampleRate = 1000 / Math.max(1, intervalMs);
  const coefficients = designBandpass(cfg.bandLowHz, cfg.bandHighHz, sampleRate);
  const filtered = filter(series.vertical, coefficients);
  const windowSamples = Math.max(5, Math.round(cfg.noiseWindowMs / Math.max(1, intervalMs)));
  const stride = Math.max(1, Math.round(windowSamples / 20));
  const floor = robustFloor(filtered, windowSamples, stride);

  const mode = resolveMode(fixes, cfg.walkingMaxKph);
  const modeCfg = mode === "vehicle" ? cfg.vehicle : cfg.pedestrian;
  const span = Math.max(2, Math.round(250 / Math.max(1, intervalMs)));

  const impacts: Impact[] = [];
  let lastEmit = Number.NEGATIVE_INFINITY;
  let i = 0;

  while (i < ordered.length) {
    const threshold = Math.max(modeCfg.absoluteFloor, modeCfg.noiseK * (floor[i] ?? 0));
    if (Math.abs(filtered[i] ?? 0) < threshold) {
      i += 1;
      continue;
    }
    let peakIndex = i;
    let j = i;
    while (j < ordered.length) {
      const t = Math.max(modeCfg.absoluteFloor, modeCfg.noiseK * (floor[j] ?? 0));
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

    const fix = nearestFix(fixes, peakTime, cfg.maxFixAgeMs);
    if (fix === null || fix.accuracy > cfg.maxFixAccuracyM) {
      continue;
    }
    const speedKph = (fix.speed ?? 0) * 3.6;
    if (speedKph < modeCfg.minSpeedKph) {
      continue;
    }

    const features = extractFeatures(series, peakIndex, span, span);
    const classification = classify(features, cfg);
    if (classification === null) {
      continue;
    }

    const snr = clamp(features.peak / Math.max(floor[peakIndex] ?? 0.1, 0.1) / 8, 0, 1);
    const accuracyFactor = clamp(1 - fix.accuracy / 40, 0, 1);
    const confidence = Number(
      clamp(0.55 * classification.score + 0.3 * snr + 0.15 * accuracyFactor, 0, 1).toFixed(3),
    );

    const gain = clamp(speedKph / cfg.speedReferenceKph, 0.6, 1.8);
    const normalised = Number((features.peak / gain).toFixed(2));

    impacts.push({
      t: peakTime,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speedKph,
      magnitude: features.peak,
      normalised,
      severity: severityOf(normalised, cfg),
      kind: classification.kind,
      confidence,
      mode,
      features,
    });
    lastEmit = peakTime;
  }

  return impacts;
}

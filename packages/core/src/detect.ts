import type { GeoFix, HazardKind, Impact, MotionSample, Severity } from "./types";

export interface DetectOptions {
  /** Minimum ground speed (km/h). Slower impacts are presumed to be walking or stationary. */
  minSpeedKph: number;
  /** Vertical acceleration above gravity (m/s^2) required to register an impact. */
  peakThreshold: number;
  /** Minimum gap (milliseconds) between two accepted impacts. */
  debounceMs: number;
  /** Maximum time (milliseconds) between an impact and its nearest position fix. */
  maxFixAgeMs: number;
  /** Impacts whose nearest fix is coarser than this (metres) are discarded. */
  maxFixAccuracyM: number;
  /** Magnitude (m/s^2) at or above which an impact is moderate. */
  moderateMagnitude: number;
  /** Magnitude (m/s^2) at or above which an impact is severe. */
  severeMagnitude: number;
  /** Elevated vertical signal lasting at least this long (milliseconds) reads as a speed bump. */
  bumpMinDurationMs: number;
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = {
  minSpeedKph: 12,
  peakThreshold: 3.9,
  debounceMs: 2000,
  maxFixAgeMs: 3000,
  maxFixAccuracyM: 50,
  moderateMagnitude: 8,
  severeMagnitude: 15,
  bumpMinDurationMs: 140,
};

/** Smoothing factor for the gravity low-pass filter (per sample). */
const GRAVITY_ALPHA = 0.08;
/** An event is considered over once the signal falls below this fraction of the threshold. */
const RELEASE_FRACTION = 0.5;

interface SeriesPoint {
  t: number;
  vhp: number;
}

interface Peak {
  t: number;
  magnitude: number;
  durationMs: number;
}

function verticalSeries(samples: MotionSample[]): SeriesPoint[] {
  const first = samples[0];
  if (first === undefined) {
    return [];
  }
  let gx = first.ax;
  let gy = first.ay;
  let gz = first.az;
  const series: SeriesPoint[] = [];
  for (const s of samples) {
    gx += GRAVITY_ALPHA * (s.ax - gx);
    gy += GRAVITY_ALPHA * (s.ay - gy);
    gz += GRAVITY_ALPHA * (s.az - gz);
    const gmag = Math.hypot(gx, gy, gz) || 1;
    const hx = s.ax - gx;
    const hy = s.ay - gy;
    const hz = s.az - gz;
    const vhp = (hx * gx + hy * gy + hz * gz) / gmag;
    series.push({ t: s.t, vhp });
  }
  return series;
}

function findPeaks(series: SeriesPoint[], options: DetectOptions): Peak[] {
  const peaks: Peak[] = [];
  let inEvent = false;
  let eventStart = 0;
  let peakValue = 0;
  let peakTime = 0;
  let lastEmitTime = Number.NEGATIVE_INFINITY;

  const close = (endTime: number): void => {
    const durationMs = endTime - eventStart;
    inEvent = false;
    if (peakValue >= options.peakThreshold && peakTime - lastEmitTime >= options.debounceMs) {
      peaks.push({ t: peakTime, magnitude: peakValue, durationMs });
      lastEmitTime = peakTime;
    }
  };

  for (const point of series) {
    if (!inEvent) {
      if (point.vhp >= options.peakThreshold) {
        inEvent = true;
        eventStart = point.t;
        peakValue = point.vhp;
        peakTime = point.t;
      }
      continue;
    }
    if (point.vhp > peakValue) {
      peakValue = point.vhp;
      peakTime = point.t;
    }
    if (point.vhp < options.peakThreshold * RELEASE_FRACTION) {
      close(point.t);
    }
  }
  if (inEvent) {
    const last = series[series.length - 1];
    close(last ? last.t : eventStart);
  }
  return peaks;
}

function nearestFix(fixes: GeoFix[], t: number, options: DetectOptions): GeoFix | null {
  let best: GeoFix | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const fix of fixes) {
    const delta = Math.abs(fix.t - t);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = fix;
    }
  }
  if (best === null || bestDelta > options.maxFixAgeMs) {
    return null;
  }
  return best;
}

function severityOf(magnitude: number, options: DetectOptions): Severity {
  if (magnitude >= options.severeMagnitude) {
    return 3;
  }
  if (magnitude >= options.moderateMagnitude) {
    return 2;
  }
  return 1;
}

function kindOf(durationMs: number, options: DetectOptions): HazardKind {
  return durationMs >= options.bumpMinDurationMs ? "speed_bump" : "pothole";
}

/**
 * Detect road impacts from a window of motion samples and position fixes.
 *
 * Gravity is removed per-axis with a low-pass filter, the residual is projected
 * onto the estimated gravity vector to isolate vertical acceleration, and peaks
 * above the threshold are emitted (debounced, speed-gated, and position-matched).
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
  const peaks = findPeaks(verticalSeries(ordered), cfg);
  const impacts: Impact[] = [];
  for (const peak of peaks) {
    const fix = nearestFix(fixes, peak.t, cfg);
    if (fix === null || fix.accuracy > cfg.maxFixAccuracyM) {
      continue;
    }
    const speedKph = (fix.speed ?? 0) * 3.6;
    if (speedKph < cfg.minSpeedKph) {
      continue;
    }
    impacts.push({
      t: peak.t,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speedKph,
      magnitude: Number(peak.magnitude.toFixed(2)),
      severity: severityOf(peak.magnitude, cfg),
      kind: kindOf(peak.durationMs, cfg),
    });
  }
  return impacts;
}

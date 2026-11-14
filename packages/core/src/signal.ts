export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[middle - 1] ?? 0;
  return (lower + upper) / 2;
}

/**
 * A second-order band-pass, centred geometrically between the two corner
 * frequencies. Road impacts live between roughly 0.5 and 6 Hz: below that is
 * cornering, braking and gradient; above it is engine and body vibration.
 */
export function designBandpass(lowHz: number, highHz: number, sampleRate: number): BiquadCoefficients {
  const centre = Math.sqrt(lowHz * highHz);
  const w0 = (2 * Math.PI * centre) / sampleRate;
  const q = centre / (highHz - lowHz);
  const alpha = Math.sin(w0) / (2 * q);
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function filter(signal: number[], coefficients: BiquadCoefficients): number[] {
  const out: number[] = new Array<number>(signal.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const x = signal[i] ?? 0;
    const y =
      coefficients.b0 * x +
      coefficients.b1 * x1 +
      coefficients.b2 * x2 -
      coefficients.a1 * y1 -
      coefficients.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Root-mean-square of each sample over a trailing window. */
export function movingRms(values: number[], window: number): number[] {
  const out: number[] = new Array<number>(values.length);
  let sumSquares = 0;
  for (let i = 0; i < values.length; i += 1) {
    const entering = values[i] ?? 0;
    sumSquares += entering * entering;
    if (i >= window) {
      const leaving = values[i - window] ?? 0;
      sumSquares -= leaving * leaving;
    }
    const count = Math.min(i + 1, window);
    out[i] = Math.sqrt(Math.max(0, sumSquares) / count);
  }
  return out;
}

/** Histogram resolution for the streaming median: 2048 bins over 0..8 m/s^2. */
export const FLOOR_BINS = 2048;
export const FLOOR_MAX = 8;
const FLOOR_BIN_WIDTH = FLOOR_MAX / FLOOR_BINS;

function floorBin(value: number): number {
  const bin = Math.floor(Math.abs(value) / FLOOR_BIN_WIDTH);
  return bin >= FLOOR_BINS ? FLOOR_BINS - 1 : bin;
}

/**
 * A spike-resistant noise floor: the scaled median absolute deviation of a
 * trailing window. A mean-square floor is inflated by the very event it is
 * meant to judge, so an impulse would raise its own threshold and hide; a
 * median ignores the impulse instead.
 *
 * The median comes from a fixed-bin histogram that is updated in O(1) per
 * sample (add the entering value, remove the leaving one), instead of sorting
 * the window. That is deterministic, allocation-free, and bit-identical between
 * the TypeScript and Java implementations. The floor is evaluated every
 * `stride` samples and held between evaluations.
 */
export function robustFloor(values: number[], window: number, stride = 1): number[] {
  const out: number[] = new Array<number>(values.length);
  const counts = new Int32Array(FLOOR_BINS);
  let current = 0;
  for (let i = 0; i < values.length; i += 1) {
    counts[floorBin(values[i] ?? 0)]! += 1;
    if (i >= window) {
      counts[floorBin(values[i - window] ?? 0)]! -= 1;
    }
    if (i % stride === 0) {
      const n = Math.min(i + 1, window);
      const target = Math.floor(n / 2);
      let seen = 0;
      let bin = 0;
      for (; bin < FLOOR_BINS - 1; bin += 1) {
        seen += counts[bin] ?? 0;
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
 * Band-pass that restarts its state after a gap in the sample clock. A phone
 * that stops delivering callbacks (doze, a busy main thread) must not smear
 * stale filter memory across the hole and manufacture an impulse.
 */
export function filterSegments(
  signal: number[],
  times: number[],
  coefficients: BiquadCoefficients,
  gapMs: number,
): number[] {
  const out: number[] = new Array<number>(signal.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    if (i > 0 && (times[i] ?? 0) - (times[i - 1] ?? 0) > gapMs) {
      x1 = 0;
      x2 = 0;
      y1 = 0;
      y2 = 0;
    }
    const x = signal[i] ?? 0;
    const y =
      coefficients.b0 * x +
      coefficients.b1 * x1 +
      coefficients.b2 * x2 -
      coefficients.a1 * y1 -
      coefficients.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/**
 * Linear resample of an irregularly timed series onto a uniform grid
 * `startT + k * 1000 / rateHz`, so frequency-domain measures (cadence) are not
 * distorted by jittery sensor callbacks.
 */
export function resampleUniform(
  times: number[],
  values: number[],
  startT: number,
  rateHz: number,
  count: number,
): number[] {
  const out: number[] = new Array<number>(count);
  const step = 1000 / rateHz;
  let j = 0;
  for (let k = 0; k < count; k += 1) {
    const t = startT + k * step;
    while (j < times.length - 2 && (times[j + 1] ?? 0) < t) {
      j += 1;
    }
    const t0 = times[j] ?? 0;
    const t1 = times[j + 1] ?? t0;
    const v0 = values[j] ?? 0;
    const v1 = values[j + 1] ?? v0;
    if (t1 <= t0) {
      out[k] = v0;
    } else {
      out[k] = v0 + (v1 - v0) * clamp((t - t0) / (t1 - t0), 0, 1);
    }
  }
  return out;
}

/**
 * Strongest normalised autocorrelation of a zero-mean series for lags in
 * [minLag, maxLag]. A periodic gait or pedal stroke gives a value near 1;
 * random road noise gives a value near 0. Orientation independent when fed an
 * acceleration magnitude, so it needs no platform step detector.
 */
export function autocorrPeak(x: number[], minLag: number, maxLag: number): { lag: number; corr: number } {
  const n = x.length;
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    energy += (x[i] ?? 0) * (x[i] ?? 0);
  }
  let bestLag = 0;
  let bestCorr = 0;
  if (energy < 1e-9 || n <= maxLag + 2) {
    return { lag: 0, corr: 0 };
  }
  const variance = energy / n;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) {
      sum += (x[i] ?? 0) * (x[i + lag] ?? 0);
    }
    const r = sum / (n - lag) / variance;
    if (r > bestCorr) {
      bestCorr = r;
      bestLag = lag;
    }
  }
  return { lag: bestLag, corr: bestCorr };
}

/** Round to 3 decimals the same way on both platforms (no toFixed / String formatting in the algorithm path). */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Median inter-sample interval, in milliseconds. */
export function medianInterval(times: number[], fallbackMs: number): number {
  if (times.length < 2) {
    return fallbackMs;
  }
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    deltas.push((times[i] ?? 0) - (times[i - 1] ?? 0));
  }
  const value = median(deltas);
  return value > 0 ? value : fallbackMs;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

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

/**
 * A spike-resistant noise floor: the scaled median absolute deviation of a
 * trailing window. A mean-square floor is inflated by the very event it is
 * meant to judge, so an impulse would raise its own threshold and hide; a
 * median ignores the impulse instead.
 *
 * The floor is evaluated every `stride` samples and held between evaluations.
 */
export function robustFloor(values: number[], window: number, stride = 1): number[] {
  const out: number[] = new Array<number>(values.length);
  const scratch: number[] = [];
  let current = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (i % stride === 0) {
      const from = Math.max(0, i - window + 1);
      scratch.length = 0;
      for (let j = from; j <= i; j += 1) {
        scratch.push(Math.abs(values[j] ?? 0));
      }
      current = 1.4826 * median(scratch);
    }
    out[i] = current;
  }
  return out;
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

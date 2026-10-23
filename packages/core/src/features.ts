import type { ImpactFeatures } from "./types";

export interface ResidualSeries {
  times: number[];
  /** Vertical acceleration with gravity and slow drift removed, m/s^2. */
  vertical: number[];
  /** Lateral acceleration at the same instants, m/s^2. */
  lateral: number[];
}

const HALF = 0.5;
const LOBE_FLOOR = 0.4;

/**
 * Characterise the pulse around an event: how fast it rose, how long it lasted,
 * how many lobes it has, how abruptly it changed, and how much of it was
 * sideways rather than vertical.
 *
 * The true peak is located on the raw vertical residual within the window. The
 * band-pass used to find the event delays it, so reading the peak at the
 * filtered maximum would understate every sharp impulse.
 */
export function extractFeatures(
  series: ResidualSeries,
  centerIndex: number,
  spanBefore: number,
  spanAfter: number,
): ImpactFeatures {
  const from = Math.max(0, centerIndex - spanBefore);
  const to = Math.min(series.vertical.length - 1, centerIndex + spanAfter);

  let peakIndex = from;
  for (let i = from; i <= to; i += 1) {
    if (Math.abs(series.vertical[i] ?? 0) > Math.abs(series.vertical[peakIndex] ?? 0)) {
      peakIndex = i;
    }
  }

  const peak = Math.abs(series.vertical[peakIndex] ?? 0);
  const half = peak * HALF;

  let start = peakIndex;
  while (start > from && Math.abs(series.vertical[start - 1] ?? 0) > half) {
    start -= 1;
  }
  let end = peakIndex;
  while (end < to && Math.abs(series.vertical[end + 1] ?? 0) > half) {
    end += 1;
  }

  const peakTime = series.times[peakIndex] ?? 0;
  const startTime = series.times[start] ?? peakTime;
  const endTime = series.times[end] ?? peakTime;
  const riseMs = Math.max(0, peakTime - startTime);
  const widthMs = Math.max(0, endTime - startTime);

  const lobeFloor = peak * LOBE_FLOOR;
  let lobes = 0;
  for (let i = from + 1; i < to; i += 1) {
    const value = Math.abs(series.vertical[i] ?? 0);
    const before = Math.abs(series.vertical[i - 1] ?? 0);
    const after = Math.abs(series.vertical[i + 1] ?? 0);
    if (value >= lobeFloor && value >= before && value > after) {
      lobes += 1;
    }
  }

  let jerk = 0;
  let lateralMax = 0;
  for (let i = from + 1; i <= to; i += 1) {
    const dt = ((series.times[i] ?? 0) - (series.times[i - 1] ?? 0)) / 1000;
    if (dt > 0) {
      jerk = Math.max(jerk, Math.abs((series.vertical[i] ?? 0) - (series.vertical[i - 1] ?? 0)) / dt);
    }
    lateralMax = Math.max(lateralMax, Math.abs(series.lateral[i] ?? 0));
  }

  return {
    peak: Number(peak.toFixed(3)),
    riseMs: Math.round(riseMs),
    widthMs: Math.round(widthMs),
    lobes: Math.max(1, lobes),
    jerk: Number(jerk.toFixed(1)),
    lateralRatio: Number((lateralMax / Math.max(peak, 0.001)).toFixed(3)),
  };
}

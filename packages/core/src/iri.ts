import { residuals } from "./detect";
import { designBandpass, filter, medianInterval } from "./signal";
import type { MotionSample } from "./types";

/**
 * Road roughness proxy categories (aligned with World Bank roughness bands:
 * Good < 2.7, Fair 2.7-4.0, Poor 4.0-5.5, Severe >= 5.5 m/km equivalent).
 *
 * IMPORTANT SCIENTIFIC DISTINCTION:
 * Standard ASTM E1926 / World Bank International Roughness Index (IRI) is a
 * geometric longitudinal road profile statistic simulated with a golden
 * quarter-car filter at 80 km/h over a measured elevation profile.
 * Smartphone accelerometer measurements inside an uncalibrated consumer
 * vehicle measure chassis/mount-filtered vertical vibration, NOT direct
 * longitudinal elevation profiles. Therefore, Hodos computes an orientation-
 * independent, band-limited (0.5-6 Hz), speed-normalized vertical acceleration
 * roughness proxy (`roughnessProxy`), and explicitly marks `calibrated: false`
 * unless vehicle/mount field calibration parameters are supplied.
 */
export type RoughnessCategory = "good" | "fair" | "poor" | "severe";
export type IRICategory = RoughnessCategory;

export interface RoughnessSegmentResult {
  /**
   * Uncalibrated smartphone-derived road roughness proxy (scaled to m/km-equivalent
   * bands for cartographic display). Not a direct ASTM E1926 laser profilometer IRI.
   */
  roughnessProxy: number;
  /**
   * Retained for backward compatibility with existing callers; equals `roughnessProxy`.
   * @deprecated Prefer `roughnessProxy` unless calibrated against reference profiles.
   */
  iri: number;
  /** Categorical road quality rating. */
  category: RoughnessCategory;
  /** Recommended hex color for map layer visualization. */
  color: string;
  /** Band-limited (0.5-6 Hz) orientation-independent vertical RMS acceleration (m/s^2). */
  rmsAcceleration: number;
  /** Total samples evaluated. */
  sampleCount: number;
  /** Explicit scientific honesty flag: false for uncalibrated consumer smartphones. */
  calibrated: boolean;
}

export type IRISegmentResult = RoughnessSegmentResult;

export interface RoughnessOptions {
  /** Minimum ground speed in km/h below which roughness estimation is paused. */
  minSpeedKph: number;
  /** Vehicle suspension dampening multiplier (1.0 for car, 1.4 for bus/truck, 0.7 for motorcycle). */
  suspensionDampening: number;
  /** EMA coefficient for gravity vector estimation. */
  gravityAlpha: number;
  /** Whether to apply the 0.5-6 Hz road-impact bandpass filter before RMS calculation. */
  bandpass: boolean;
  /** Whether the vehicle/mount factor has been field-calibrated against a reference profiler. */
  calibrated: boolean;
  /** Legacy gravity constant retained for API compatibility. */
  gravity: number;
}

export type IRIOptions = RoughnessOptions;

export const DEFAULT_ROUGHNESS_OPTIONS: RoughnessOptions = {
  minSpeedKph: 10.0,
  suspensionDampening: 1.0,
  gravityAlpha: 0.02,
  bandpass: true,
  calibrated: false,
  gravity: 9.80665,
};

export const DEFAULT_IRI_OPTIONS: IRIOptions = DEFAULT_ROUGHNESS_OPTIONS;

/**
 * Classify a roughness proxy value into standard road condition categories.
 */
export function classifyRoughness(value: number): RoughnessCategory {
  if (value < 2.7) return "good";
  if (value < 4.0) return "fair";
  if (value < 5.5) return "poor";
  return "severe";
}

export const classifyIRI = classifyRoughness;

/**
 * Return cartographic color for a roughness category.
 */
export function roughnessColor(category: RoughnessCategory): string {
  switch (category) {
    case "good":
      return "#2C5530"; // Forest green
    case "fair":
      return "#D97706"; // Amber
    case "poor":
      return "#DC2626"; // Crimson
    case "severe":
      return "#7F1D1D"; // Dark maroon
  }
}

export const iriColor = roughnessColor;

/**
 * Computes an orientation-independent, speed-normalized road roughness proxy
 * from 3-axis accelerometer samples using 3D gravity EMA projection and
 * 0.5-6 Hz band-pass filtering.
 */
export function estimateRoughnessProxy(
  samples: MotionSample[],
  avgSpeedKph: number,
  options: Partial<RoughnessOptions> = {},
): RoughnessSegmentResult {
  const opts: RoughnessOptions = { ...DEFAULT_ROUGHNESS_OPTIONS, ...options };

  if (samples.length < 5 || avgSpeedKph < opts.minSpeedKph) {
    return {
      roughnessProxy: 0,
      iri: 0,
      category: "good",
      color: roughnessColor("good"),
      rmsAcceleration: 0,
      sampleCount: samples.length,
      calibrated: opts.calibrated,
    };
  }

  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const series = residuals(ordered, opts.gravityAlpha);

  let verticalSignal = series.vertical;
  if (opts.bandpass && ordered.length >= 10) {
    const intervalMs = medianInterval(series.times, 20);
    const sampleRate = 1000 / Math.max(1, intervalMs);
    if (sampleRate > 14) {
      verticalSignal = filter(series.vertical, designBandpass(0.5, 6.0, sampleRate));
    }
  }

  let sumSquaredVertical = 0;
  for (const v of verticalSignal) {
    sumSquaredVertical += v * v;
  }
  const rms = Math.sqrt(sumSquaredVertical / verticalSignal.length);

  // Speed-normalized empirical roughness proxy (reference speed 50 km/h)
  const speedFactor = Math.sqrt(avgSpeedKph / 50.0);
  const normalizedRms = speedFactor > 0.05 ? rms / speedFactor : rms;

  const rawProxy = normalizedRms * 3.8 * opts.suspensionDampening;
  const roughnessProxy = Math.round(Math.max(0.5, rawProxy) * 10) / 10;
  const category = classifyRoughness(roughnessProxy);

  return {
    roughnessProxy,
    iri: roughnessProxy,
    category,
    color: roughnessColor(category),
    rmsAcceleration: Math.round(rms * 100) / 100,
    sampleCount: ordered.length,
    calibrated: opts.calibrated,
  };
}

/**
 * Retained for backward compatibility; delegates to `estimateRoughnessProxy`.
 */
export const estimateIRI = estimateRoughnessProxy;

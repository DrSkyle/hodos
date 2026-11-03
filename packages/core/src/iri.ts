import type { MotionSample } from "./types";

/**
 * Standard World Bank road roughness categories.
 * Good: IRI < 2.7 m/km (smooth pavement / newly paved)
 * Fair: 2.7 <= IRI < 4.0 m/km (minor cracking or surface wear)
 * Poor: 4.0 <= IRI < 5.5 m/km (significant roughness, frequent bumps)
 * Severe: IRI >= 5.5 m/km (major defects, severe potholes, unpaved stretches)
 */
export type IRICategory = "good" | "fair" | "poor" | "severe";

export interface IRISegmentResult {
  /** Estimated International Roughness Index in m/km. */
  iri: number;
  /** Categorical road quality rating. */
  category: IRICategory;
  /** Recommended hex color for map layer visualization. */
  color: string;
  /** Vertical root-mean-square acceleration (m/s^2). */
  rmsAcceleration: number;
  /** Total samples evaluated. */
  sampleCount: number;
}

export interface IRIOptions {
  /** Minimum ground speed in km/h below which IRI estimation is paused. */
  minSpeedKph: number;
  /** Vehicle suspension dampening multiplier (1.0 for car, 1.4 for bus/truck, 0.7 for motorcycle). */
  suspensionDampening: number;
  /** Gravity constant subtracted from vertical axis (m/s^2). */
  gravity: number;
}

export const DEFAULT_IRI_OPTIONS: IRIOptions = {
  minSpeedKph: 10.0,
  suspensionDampening: 1.0,
  gravity: 9.80665,
};

/**
 * Classify a numerical IRI value into standard road condition categories.
 */
export function classifyIRI(iri: number): IRICategory {
  if (iri < 2.7) return "good";
  if (iri < 4.0) return "fair";
  if (iri < 5.5) return "poor";
  return "severe";
}

/**
 * Return cartographic color for an IRI category.
 */
export function iriColor(category: IRICategory): string {
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

/**
 * Estimates International Roughness Index (IRI in m/km) from vertical accelerometer
 * samples and average vehicle travel speed using quarter-car acceleration modeling.
 */
export function estimateIRI(
  samples: MotionSample[],
  avgSpeedKph: number,
  options: Partial<IRIOptions> = {}
): IRISegmentResult {
  const opts: IRIOptions = { ...DEFAULT_IRI_OPTIONS, ...options };

  if (samples.length < 5 || avgSpeedKph < opts.minSpeedKph) {
    return {
      iri: 0,
      category: "good",
      color: iriColor("good"),
      rmsAcceleration: 0,
      sampleCount: samples.length,
    };
  }

  // Calculate root-mean-square of vertical dynamic acceleration
  let sumSquaredVertical = 0;
  for (const s of samples) {
    // Dynamic vertical deviation (removing earth gravity component)
    const dynamicZ = Math.abs(s.az) - opts.gravity;
    sumSquaredVertical += dynamicZ * dynamicZ;
  }
  const rms = Math.sqrt(sumSquaredVertical / samples.length);

  // Speed-normalized quarter-car empirical approximation
  // Standard World Bank mobile IRI approximation: IRI = (alpha * RMS) / sqrt(speed)
  const speedFactor = Math.sqrt(avgSpeedKph / 50.0);
  const normalizedRms = speedFactor > 0.05 ? rms / speedFactor : rms;
  
  // Convert normalized RMS (m/s^2) to IRI (m/km) adjusted by suspension factor
  const rawIri = normalizedRms * 3.8 * opts.suspensionDampening;
  const iri = Math.round(Math.max(0.5, rawIri) * 10) / 10;
  const category = classifyIRI(iri);

  return {
    iri,
    category,
    color: iriColor(category),
    rmsAcceleration: Math.round(rms * 100) / 100,
    sampleCount: samples.length,
  };
}

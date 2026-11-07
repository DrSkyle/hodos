import { detectImpacts } from "./detect";
import type { GeoFix, HazardKind, Impact, MotionSample } from "./types";

/**
 * Ground-truth annotation for a recorded field-validation road event.
 */
export interface AnnotatedEvent {
  /** Timestamp of physical defect traversal (epoch ms). */
  t: number;
  /** True defect class, or "non_defect" for hard negatives (braking, turns, smooth road, phone handling). */
  kind: HazardKind | "non_defect";
  /** Ground-truth latitude of the road defect. */
  lat: number;
  /** Ground-truth longitude of the road defect. */
  lng: number;
  /** Optional human-verified severity (1..3) or surface label (e.g. "manhole", "expansion_joint"). */
  notes?: string;
}

/**
 * Metadata for a field-validation recording trace across vehicle classes,
 * phone mounting positions, and device models.
 */
export interface ValidationTrace {
  traceId: string;
  vehicleClass: "sedan" | "suv" | "bus" | "truck" | "motorcycle" | "bicycle" | "pedestrian";
  mountingPosition: "dashboard_cradle" | "cupholder" | "seat" | "pocket" | "handlebar";
  phoneModel: string;
  samples: MotionSample[];
  fixes: GeoFix[];
  groundTruth: AnnotatedEvent[];
}

export interface CalibrationBin {
  binLow: number;
  binHigh: number;
  count: number;
  meanPredictedConfidence: number;
  empiricalPrecision: number;
}

export interface ValidationReport {
  totalGroundTruthDefects: number;
  totalPredictedImpacts: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  classMismatches: number;
  precision: number;
  recall: number;
  f1: number;
  meanLocalizationErrorM: number;
  expectedCalibrationError: number;
  calibrationBins: CalibrationBin[];
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earth = 6371008.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Evaluates the Hodos detector against a collection of annotated field-validation
 * traces, computing precision, recall, F1, spatial localization error, and
 * confidence calibration (Expected Calibration Error across 5 bins).
 *
 * A predicted impact matches a ground-truth defect if it occurs within
 * `matchWindowMs` (default 600 ms) and matches the defect class.
 */
export function evaluateValidationDataset(
  traces: ValidationTrace[],
  matchWindowMs = 600,
): ValidationReport {
  let totalGroundTruthDefects = 0;
  let totalPredictedImpacts = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let classMismatches = 0;
  const localizationErrors: number[] = [];
  const scoredPredictions: Array<{ confidence: number; correct: boolean }> = [];

  for (const trace of traces) {
    const predicted: Impact[] = detectImpacts(trace.samples, trace.fixes);
    totalPredictedImpacts += predicted.length;

    const trueDefects = trace.groundTruth.filter(
      (g): g is AnnotatedEvent & { kind: HazardKind } => g.kind !== "non_defect",
    );
    totalGroundTruthDefects += trueDefects.length;

    const matchedTruth = new Set<number>();

    for (const pred of predicted) {
      let bestIdx = -1;
      let bestTimeDelta = Number.POSITIVE_INFINITY;
      for (let i = 0; i < trueDefects.length; i += 1) {
        if (matchedTruth.has(i)) continue;
        const gt = trueDefects[i]!;
        const dt = Math.abs(pred.t - gt.t);
        if (dt <= matchWindowMs && dt < bestTimeDelta) {
          bestTimeDelta = dt;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        const gt = trueDefects[bestIdx]!;
        matchedTruth.add(bestIdx);
        if (pred.kind === gt.kind) {
          truePositives += 1;
          localizationErrors.push(haversineM(pred.lat, pred.lng, gt.lat, gt.lng));
          scoredPredictions.push({ confidence: pred.confidence, correct: true });
        } else {
          classMismatches += 1;
          falsePositives += 1;
          falseNegatives += 1;
          scoredPredictions.push({ confidence: pred.confidence, correct: false });
        }
      } else {
        falsePositives += 1;
        scoredPredictions.push({ confidence: pred.confidence, correct: false });
      }
    }

    for (let i = 0; i < trueDefects.length; i += 1) {
      if (!matchedTruth.has(i)) {
        falseNegatives += 1;
      }
    }
  }

  const precision =
    totalPredictedImpacts > 0 ? truePositives / totalPredictedImpacts : 1;
  const recall =
    totalGroundTruthDefects > 0 ? truePositives / totalGroundTruthDefects : 1;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const meanLocalizationErrorM =
    localizationErrors.length > 0
      ? localizationErrors.reduce((a, b) => a + b, 0) / localizationErrors.length
      : 0;

  const numBins = 5;
  const calibrationBins: CalibrationBin[] = [];
  let ece = 0;
  for (let b = 0; b < numBins; b += 1) {
    const binLow = b / numBins;
    const binHigh = (b + 1) / numBins;
    const inBin = scoredPredictions.filter((p) =>
      b === numBins - 1
        ? p.confidence >= binLow && p.confidence <= binHigh
        : p.confidence >= binLow && p.confidence < binHigh,
    );
    const count = inBin.length;
    const meanConf =
      count > 0 ? inBin.reduce((s, p) => s + p.confidence, 0) / count : 0;
    const empPrec =
      count > 0 ? inBin.filter((p) => p.correct).length / count : 0;
    if (scoredPredictions.length > 0 && count > 0) {
      ece += (count / scoredPredictions.length) * Math.abs(empPrec - meanConf);
    }
    calibrationBins.push({
      binLow: Number(binLow.toFixed(2)),
      binHigh: Number(binHigh.toFixed(2)),
      count,
      meanPredictedConfidence: Number(meanConf.toFixed(3)),
      empiricalPrecision: Number(empPrec.toFixed(3)),
    });
  }

  return {
    totalGroundTruthDefects,
    totalPredictedImpacts,
    truePositives,
    falsePositives,
    falseNegatives,
    classMismatches,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1: Number(f1.toFixed(3)),
    meanLocalizationErrorM: Number(meanLocalizationErrorM.toFixed(2)),
    expectedCalibrationError: Number(ece.toFixed(3)),
    calibrationBins,
  };
}

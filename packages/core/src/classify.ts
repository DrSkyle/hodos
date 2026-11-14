import { clamp, round3 } from "./signal";
import type { HazardKind, ImpactFeatures } from "./types";

export interface ClassifyOptions {
  /** Rise time below this (ms) reads as sharp, i.e. a pothole edge. */
  sharpRiseMs: number;
  /** Width above this (ms) reads as long, i.e. a ramp rather than an edge. */
  bumpMinWidthMs: number;
  /** Jerk per unit peak (1/s) at which abruptness saturates. */
  jerkRef: number;
  /** Lateral share above which the event is not a road defect at all (extreme only). */
  maxLateralRatio: number;
  /** Lateral share at which the soft penalty starts: an angled pothole survives, a kerb strike does not. */
  softLateralRatio: number;
  /** Largest score penalty the lateral share can apply. */
  lateralPenalty: number;
  /** Yaw rate (deg/s) that, with real lateral load, marks a swerve. */
  yawRejectDps: number;
  /** Peak gyro (deg/s) at which the phone itself is being moved (handling). */
  handlingGyroDps: number;
  /** Road-band energy share below which the pulse is broadband (a tap, a drop). */
  minRoadBandRatio: number;
  /** Score a class must reach before the event is kept. */
  minScore: number;
}

export const DEFAULT_CLASSIFY_OPTIONS: ClassifyOptions = {
  sharpRiseMs: 60,
  bumpMinWidthMs: 180,
  jerkRef: 50,
  maxLateralRatio: 1.4,
  softLateralRatio: 0.5,
  lateralPenalty: 0.3,
  yawRejectDps: 35,
  handlingGyroDps: 120,
  minRoadBandRatio: 0.35,
  minScore: 0.5,
};

export interface Classification {
  kind: HazardKind;
  /** Confidence in the label itself, 0..1. */
  score: number;
}

/**
 * Score the event against the three defect signatures and take the best.
 *
 * A pothole is a sharp, high-jerk, narrow pulse. A speed bump is a long, low-jerk
 * ramp. Rough pavement is a band of many small lobes. Anything that is mostly
 * lateral is a swerve or a kerb strike, and is rejected outright.
 */
export function classify(
  features: ImpactFeatures,
  options: Partial<ClassifyOptions> = {},
): Classification | null {
  const cfg: ClassifyOptions = { ...DEFAULT_CLASSIFY_OPTIONS, ...options };
  if (features.lateralRatio > cfg.maxLateralRatio) {
    return null;
  }
  // A swerve is lateral load AND rotation about the vertical axis.
  if (
    features.yawPeakDps !== undefined &&
    features.yawPeakDps >= cfg.yawRejectDps &&
    features.lateralRatio > cfg.softLateralRatio
  ) {
    return null;
  }
  if (features.gyroPeakDps !== undefined && features.gyroPeakDps >= cfg.handlingGyroDps * 2) {
    return null;
  }

  // Soft evidence against "road defect": sideways share, handling rotation, broadband energy.
  const lateralSpan = Math.max(1e-6, cfg.maxLateralRatio - cfg.softLateralRatio);
  let penalty =
    cfg.lateralPenalty * clamp((features.lateralRatio - cfg.softLateralRatio) / lateralSpan, 0, 1);
  if (features.gyroPeakDps !== undefined) {
    penalty += 0.25 * clamp((features.gyroPeakDps - cfg.handlingGyroDps / 2) / cfg.handlingGyroDps, 0, 1);
  }
  if (features.roadBandRatio !== undefined) {
    penalty += 0.25 * clamp(1 - features.roadBandRatio / cfg.minRoadBandRatio, 0, 1);
  }

  const sharpness = clamp(1 - features.riseMs / cfg.sharpRiseMs, 0, 1);
  const width = clamp(features.widthMs / cfg.bumpMinWidthMs, 0, 1);
  const lobes = clamp((features.lobes - 1) / 2, 0, 1);
  const jerkRate = features.jerk / Math.max(features.peak, 1);
  const jerk = clamp(jerkRate / cfg.jerkRef, 0, 1);

  const raw: Array<{ kind: HazardKind; score: number }> = [
    {
      kind: "pothole",
      score: clamp(0.45 * sharpness + 0.3 * jerk + 0.25 * (1 - width) - 0.3 * lobes, 0, 1),
    },
    {
      kind: "speed_bump",
      score: clamp(0.6 * width + 0.25 * (1 - jerk) + 0.15 * (1 - sharpness) - 0.2 * lobes, 0, 1),
    },
    {
      kind: "rough_pavement",
      score: clamp(0.55 * lobes + 0.25 * width + 0.2 * (1 - sharpness), 0, 1),
    },
  ];
  const scores = raw.map((r) => ({ kind: r.kind, score: clamp(r.score - penalty, 0, 1) }));
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (best === undefined || best.score < cfg.minScore) {
    return null;
  }
  const runnerUp = scores[1]?.score ?? 0;
  const margin = clamp((best.score - runnerUp) / 0.25, 0, 1);
  return { kind: best.kind, score: round3(clamp(0.7 * best.score + 0.3 * margin, 0, 1)) };
}

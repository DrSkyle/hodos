import { haversineMeters } from "./geo";
import type { GeoFix, Hazard, Impact } from "./types";

export interface ClearanceOptions {
  /** How close a Device must travel for the visit to count as a pass. */
  passDistanceM: number;
  /** An impact within this distance confirms the hazard instead. */
  impactDistanceM: number;
  /** Fixes coarser than this (metres) are not trusted as a traversal. */
  maxFixAccuracyM: number;
}

export const DEFAULT_CLEARANCE_OPTIONS: ClearanceOptions = {
  passDistanceM: 22,
  impactDistanceM: 25,
  maxFixAccuracyM: 25,
};

/**
 * Hazards a Device travelled past without feeling anything.
 *
 * This is the negative observation that lets the map heal itself. An impact is
 * evidence a defect is there; travelling the same road and feeling nothing is
 * evidence it is gone. Only the conclusion is uploaded, never the track.
 */
export function passedHazards<T extends Hazard>(
  fixes: GeoFix[],
  hazards: T[],
  impacts: Impact[],
  options: Partial<ClearanceOptions> = {},
): T[] {
  const cfg: ClearanceOptions = { ...DEFAULT_CLEARANCE_OPTIONS, ...options };
  const trusted = fixes.filter((fix) => fix.accuracy <= cfg.maxFixAccuracyM);
  if (trusted.length === 0) {
    return [];
  }

  const passed: T[] = [];
  for (const hazard of hazards) {
    const travelled = trusted.some((fix) => haversineMeters(fix, hazard) <= cfg.passDistanceM);
    if (!travelled) {
      continue;
    }
    const felt = impacts.some((impact) => haversineMeters(impact, hazard) <= cfg.impactDistanceM);
    if (!felt) {
      passed.push(hazard);
    }
  }
  return passed;
}

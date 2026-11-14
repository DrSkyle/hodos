import { haversineMeters } from "./geo";
import type { GeoFix } from "./types";

export interface PlacementOptions {
  /** Fixes coarser than this (metres) are never trusted. */
  maxFixAccuracyM: number;
  /** Longest gap between two bracketing fixes that may be interpolated across. */
  maxGapMs: number;
  /** An impact must be within this of its nearest fix. */
  maxFixAgeMs: number;
  /** One-sided placement (start/end of a trace) is allowed only this close to a fix. */
  edgeMs: number;
  /** Plausible ground speed, m/s, for a consecutive-fix transition (jitter allowance = + 30 m). */
  maxTransitionMps: number;
}

export const DEFAULT_PLACEMENT_OPTIONS: PlacementOptions = {
  maxFixAccuracyM: 50,
  maxGapMs: 5000,
  maxFixAgeMs: 3000,
  edgeMs: 1500,
  maxTransitionMps: 45,
};

export interface Placement {
  lat: number;
  lng: number;
  accuracy: number;
  /** Ground speed at the impact, km/h. */
  speedKph: number;
}

/**
 * Keep only fixes a road observation can be built on: finite, in range,
 * accurate, ordered, and physically reachable from the previous kept fix
 * (rejects multipath teleports, same rule as the Android LocationFixPolicy).
 * If three fixes in a row are rejected the anchor was probably the bad one, so
 * the filter re-anchors on the newest.
 */
export function sanitizeFixes(fixes: GeoFix[], options: Partial<PlacementOptions> = {}): GeoFix[] {
  const o: PlacementOptions = { ...DEFAULT_PLACEMENT_OPTIONS, ...options };
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  const kept: GeoFix[] = [];
  let rejectedRun = 0;
  for (const fix of sorted) {
    if (
      !Number.isFinite(fix.t) ||
      !Number.isFinite(fix.lat) ||
      !Number.isFinite(fix.lng) ||
      Math.abs(fix.lat) > 90 ||
      Math.abs(fix.lng) > 180 ||
      !Number.isFinite(fix.accuracy) ||
      fix.accuracy < 0 ||
      fix.accuracy > o.maxFixAccuracyM
    ) {
      continue;
    }
    const prev = kept[kept.length - 1];
    if (prev !== undefined) {
      if (fix.t <= prev.t) {
        continue;
      }
      const dt = (fix.t - prev.t) / 1000;
      if (haversineMeters(prev, fix) > dt * o.maxTransitionMps + 30) {
        rejectedRun += 1;
        if (rejectedRun < 3) {
          continue;
        }
      }
    }
    rejectedRun = 0;
    kept.push(fix);
  }
  return kept;
}

function speedOf(fix: GeoFix): number | null {
  return fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
}

/**
 * A credible road position for an event at time `t`, or null.
 *
 * Between two bracketing fixes the position is interpolated (better than
 * snapping to the nearest). Inside a GPS gap longer than `maxGapMs` - a tunnel,
 * an underpass - there is no placement, so nothing is fabricated or
 * back-filled when GPS returns. `fixes` must come from `sanitizeFixes`.
 */
export function placeAt(fixes: GeoFix[], t: number, options: Partial<PlacementOptions> = {}): Placement | null {
  const o: PlacementOptions = { ...DEFAULT_PLACEMENT_OPTIONS, ...options };
  let lo = 0;
  let hi = fixes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid]!.t < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const before = lo > 0 ? fixes[lo - 1]! : null;
  const after = lo < fixes.length ? fixes[lo]! : null;

  if (before !== null && after !== null) {
    const gap = after.t - before.t;
    if (gap > o.maxGapMs || Math.min(t - before.t, after.t - t) > o.maxFixAgeMs) {
      return null;
    }
    const w = gap > 0 ? (t - before.t) / gap : 0;
    const lat = before.lat + (after.lat - before.lat) * w;
    const lng = before.lng + (after.lng - before.lng) * w;
    const sb = speedOf(before);
    const sa = speedOf(after);
    let mps: number | null;
    if (sb !== null && sa !== null) {
      mps = sb + (sa - sb) * w;
    } else if (gap > 0) {
      mps = haversineMeters(before, after) / (gap / 1000);
    } else {
      mps = sb ?? sa;
    }
    if (mps === null) {
      return null;
    }
    return { lat, lng, accuracy: Math.max(before.accuracy, after.accuracy), speedKph: mps * 3.6 };
  }

  const only = before ?? after;
  if (only === null || Math.abs(only.t - t) > o.edgeMs) {
    return null;
  }
  const mps = speedOf(only);
  if (mps === null) {
    return null;
  }
  return { lat: only.lat, lng: only.lng, accuracy: only.accuracy, speedKph: mps * 3.6 };
}

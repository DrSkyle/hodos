import { centroid, haversineMeters } from "./geo";
import type { Hazard, HazardKind, ObservedImpact, Severity } from "./types";

export interface ClusterOptions {
  /** Impacts closer than this (metres) join the same cluster. */
  mergeDistanceM: number;
  /** Impacts required before a cluster is published to the public map. */
  publishMinPasses: number;
  /** Distinct Devices required before a cluster is published. */
  publishMinDevices: number;
  /** Confidence halves over this many days without a fresh impact. */
  halfLifeDays: number;
  /** Reference time (epoch milliseconds) for recency. */
  now: number;
}

export const DEFAULT_CLUSTER_OPTIONS: Omit<ClusterOptions, "now"> = {
  mergeDistanceM: 15,
  publishMinPasses: 3,
  publishMinDevices: 2,
  halfLifeDays: 90,
};

const MS_PER_DAY = 86_400_000;

function mode<T>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Group corroborating impacts into hazards, scoring each by confidence. */
export function clusterImpacts(
  impacts: ObservedImpact[],
  options: Partial<ClusterOptions> = {},
): Hazard[] {
  const cfg: ClusterOptions = { ...DEFAULT_CLUSTER_OPTIONS, now: Date.now(), ...options };
  const ordered = [...impacts].sort((a, b) => a.t - b.t);
  const groups: ObservedImpact[][] = [];

  for (const impact of ordered) {
    let placed = false;
    for (const group of groups) {
      if (group.length > 0 && haversineMeters(centroid(group), impact) <= cfg.mergeDistanceM) {
        group.push(impact);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([impact]);
    }
  }

  return groups.map((group) => {
    const center = centroid(group);
    const deviceCount = new Set(group.map((impact) => impact.deviceId)).size;
    const passCount = group.length;
    const lastSeen = Math.max(...group.map((impact) => impact.t));
    const firstSeen = Math.min(...group.map((impact) => impact.t));

    const passFactor = Math.min(1, passCount / cfg.publishMinPasses);
    const deviceFactor = Math.min(1, deviceCount / cfg.publishMinDevices);
    const ageDays = Math.max(0, (cfg.now - lastSeen) / MS_PER_DAY);
    const recency = Math.pow(0.5, ageDays / cfg.halfLifeDays);
    const confidence = Math.round(clamp01((0.65 * passFactor + 0.35 * deviceFactor) * recency) * 1000) / 1000;

    return {
      id: `${center.lat.toFixed(4)}:${center.lng.toFixed(4)}`,
      lat: Number(center.lat.toFixed(6)),
      lng: Number(center.lng.toFixed(6)),
      kind: mode(
        group.map((impact) => impact.kind),
        "pothole" as HazardKind,
      ),
      severity: Math.max(...group.map((impact) => impact.severity)) as Severity,
      passCount,
      deviceCount,
      confidence,
      firstSeen,
      lastSeen,
      published: passCount >= cfg.publishMinPasses && deviceCount >= cfg.publishMinDevices,
    };
  });
}

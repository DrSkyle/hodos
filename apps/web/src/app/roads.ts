import type { Trail } from "./state";
import type { Profile } from "./state";
import type { RemoteHazard } from "./recorder";

/**
 * Road intelligence, computed here from journeys this browser recorded.
 *
 * The scoring mirrors the Android app exactly — same ~150 m cells, same
 * roughness and stress penalties, same surface inference — so the web app and
 * the APK describe the same road in the same words. Nothing here is uploaded.
 */

export type SurfaceKind = "Asphalt" | "Gravel" | "Cobbles" | "Unclassified";

export type RoadCell = {
  key: string;
  lat: number;
  lng: number;
  passes: number;
  roughness: number;
  meanSpeedKph: number;
  impacts: number;
  stress: number;
  quality: number;
  grade: "Smooth" | "Fair" | "Rough" | "Severe";
  surface: SurfaceKind;
};

const CELL_DEG = 0.0015;

function cellKey(lat: number, lng: number): string {
  const latBucket = Math.floor(lat / CELL_DEG);
  const scale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lngBucket = Math.floor(lng / (CELL_DEG / scale));
  return `${latBucket}:${lngBucket}`;
}

function cellCenter(key: string): { lat: number; lng: number } {
  const [latPart, lngPart] = key.split(":").map(Number);
  const latBucket = latPart ?? 0;
  const lngBucket = lngPart ?? 0;
  const lat = (latBucket + 0.5) * CELL_DEG;
  const scale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lng = (lngBucket + 0.5) * (CELL_DEG / scale);
  return { lat, lng };
}

function severityStress(severity: number): number {
  return severity >= 3 ? 5 : severity === 2 ? 2.5 : 1;
}

export function cellsFromTrails(trails: Trail[]): RoadCell[] {
  type Acc = {
    passes: number;
    roughSum: number;
    roughCount: number;
    speedSum: number;
    speedCount: number;
    impacts: number;
    stress: number;
  };
  const buckets = new Map<string, Acc>();
  const bucketFor = (key: string): Acc => {
    let acc = buckets.get(key);
    if (!acc) {
      acc = { passes: 0, roughSum: 0, roughCount: 0, speedSum: 0, speedCount: 0, impacts: 0, stress: 0 };
      buckets.set(key, acc);
    }
    return acc;
  };

  for (const trail of trails) {
    for (const fix of trail.fixes) {
      if (!Number.isFinite(fix.roughness) || fix.roughness < 0) continue;
      const acc = bucketFor(cellKey(fix.lat, fix.lng));
      acc.passes += 1;
      acc.roughSum += fix.roughness;
      acc.roughCount += 1;
      if (Number.isFinite(fix.speed ?? NaN) && (fix.speed ?? 0) >= 0) {
        acc.speedSum += (fix.speed ?? 0) * 3.6;
        acc.speedCount += 1;
      }
    }
  }

  const cells: RoadCell[] = [];
  for (const [key, acc] of buckets) {
    const { lat, lng } = cellCenter(key);
    const roughness = acc.roughCount > 0 ? acc.roughSum / acc.roughCount : 0;
    const impacts = acc.impacts;
    const stress = acc.stress;
    const roughPenalty = Math.min(60, Math.max(0, roughness * 260));
    const impactPenalty = Math.min(40, Math.max(0, stress * 1.6));
    const quality = Math.max(0, Math.min(100, Math.round(100 - roughPenalty - impactPenalty)));
    const impactRate = acc.passes > 0 ? impacts / acc.passes : 0;
    const surface: SurfaceKind =
      acc.passes < 2
        ? "Unclassified"
        : roughness < 0.055
        ? "Asphalt"
        : roughness >= 0.1 && impactRate < 0.6
        ? "Cobbles"
        : impactRate >= 0.6
        ? "Gravel"
        : roughness >= 0.075
        ? "Gravel"
        : "Asphalt";
    cells.push({
      key,
      lat,
      lng,
      passes: acc.passes,
      roughness,
      meanSpeedKph: acc.speedCount > 0 ? acc.speedSum / acc.speedCount : 0,
      impacts,
      stress,
      quality,
      grade: quality >= 82 ? "Smooth" : quality >= 62 ? "Fair" : quality >= 40 ? "Rough" : "Severe",
      surface
    });
  }
  return cells.sort((a, b) => b.stress - a.stress);
}

export type SurfaceShare = { kind: SurfaceKind; meters: number; share: number };

export function surfaceShare(cells: RoadCell[]): SurfaceShare[] {
  const byKind = new Map<SurfaceKind, number>();
  let total = 0;
  for (const cell of cells) {
    if (cell.surface === "Unclassified") continue;
    const meters = cell.passes * 12;
    byKind.set(cell.surface, (byKind.get(cell.surface) ?? 0) + meters);
    total += meters;
  }
  if (total <= 0) return [];
  return [...byKind.entries()]
    .map(([kind, meters]) => ({ kind, meters, share: meters / total }))
    .sort((a, b) => b.share - a.share);
}

const WEAR_FACTOR: Record<Profile, number> = { bike: 0.22, scooter: 0.55, car: 1, mixed: 0.85 };
const WEAR_LABEL: Record<Profile, string> = {
  bike: "Bicycle",
  scooter: "Scooter",
  car: "Car",
  mixed: "Mixed fleet"
};

export type WearEstimate = {
  loadIndex: number;
  distanceKm: number;
  vehicleLabel: string;
  repairCostLow: number;
  repairCostHigh: number;
};

export function wearEstimate(cells: RoadCell[], profile: Profile): WearEstimate {
  let load = 0;
  let km = 0;
  for (const cell of cells) {
    if (cell.roughness <= 0) continue;
    const cellKm = (cell.passes * 12) / 1000;
    km += cellKm;
    const excess = Math.max(0, cell.roughness - 0.02);
    load += cellKm * Math.pow(excess, 1.4) * 1000;
  }
  const factor = WEAR_FACTOR[profile];
  const loadIndex = Math.max(0, Math.min(1000, Math.round(load * factor)));
  return {
    loadIndex,
    distanceKm: km,
    vehicleLabel: WEAR_LABEL[profile],
    repairCostLow: Math.round(90 + loadIndex * 0.9 * factor),
    repairCostHigh: Math.round(260 + loadIndex * 2.4 * factor)
  };
}

export type DeteriorationRow = { hazard: RemoteHazard; risk: number; ageDays: number };

export function deteriorationWatch(hazards: RemoteHazard[], now = Date.now()): DeteriorationRow[] {
  const rows: DeteriorationRow[] = [];
  for (const hazard of hazards) {
    if (hazard.fixed) continue;
    const firstSeen = hazard.lastSeen ? Date.parse(hazard.lastSeen) : NaN;
    if (!Number.isFinite(firstSeen)) continue;
    const ageDays = Math.max(0, Math.floor((now - firstSeen) / 86_400_000));
    const risk = hazard.severity * 10 + hazard.passes * 2 + Math.min(20, Math.floor(ageDays / 7));
    rows.push({ hazard, risk, ageDays });
  }
  return rows.sort((a, b) => b.risk - a.risk).slice(0, 6);
}

export type RepairCluster = { lat: number; lng: number; hazards: number; stress: number; share: number };

export function repairClusters(hazards: RemoteHazard[], maxClusters = 5): RepairCluster[] {
  const buckets = new Map<string, { lat: number; lng: number; hazards: number; stress: number }>();
  for (const hazard of hazards) {
    if (hazard.fixed) continue;
    const key = cellKey(hazard.lat, hazard.lng);
    const centre = cellCenter(key);
    const bucket = buckets.get(key) ?? { lat: centre.lat, lng: centre.lng, hazards: 0, stress: 0 };
    bucket.hazards += 1;
    bucket.stress += severityStress(hazard.severity);
    buckets.set(key, bucket);
  }
  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.stress, 0);
  if (total <= 0) return [];
  return [...buckets.values()]
    .sort((a, b) => b.stress - a.stress)
    .slice(0, maxClusters)
    .map((bucket) => ({ ...bucket, share: bucket.stress / total }));
}

export function smoothRouteScore(cells: RoadCell[]): number | null {
  if (cells.length === 0) return null;
  const ranked = [...cells].sort((a, b) => b.quality - a.quality);
  const take = Math.max(1, Math.floor(ranked.length * 0.25));
  const slice = ranked.slice(0, take);
  return Math.round(slice.reduce((sum, cell) => sum + cell.quality, 0) / slice.length);
}

export function smoothRouteSummary(cells: RoadCell[]): string | null {
  if (cells.length < 4) return null;
  const best = cells.reduce((a, b) => (b.quality > a.quality ? b : a));
  const worst = cells.reduce((a, b) => (b.quality < a.quality ? b : a));
  const delta = worst.quality - best.quality;
  if (delta <= 5) return `This corridor is uniformly ${best.grade.toLowerCase()}.`;
  return `Choosing ${best.grade.toLowerCase()} stretches over ${worst.grade.toLowerCase()} gains ${delta} quality points on this corridor.`;
}

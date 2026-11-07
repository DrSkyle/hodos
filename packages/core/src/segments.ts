import { haversineMeters } from "./geo";
import { H3_RESOLUTIONS, h3BoundaryGeoJSON, h3Center, pointToH3 } from "./h3";
import type { Hazard, ObservedImpact, Severity } from "./types";

export type SegmentEvidenceState =
  | "verified_clear"
  | "verified_hazards"
  | "repaired"
  | "reappeared"
  | "limited_coverage"
  | "unmapped";

export interface SegmentPassObservation {
  deviceId: string;
  tripId: string;
  t: number;
  lat: number;
  lng: number;
  roughnessProxy?: number;
}

export interface RoadSegmentSummary {
  /** Stable identifier: either corridor ID or `h3:<res10Index>`. */
  segmentId: string;
  /** Optional human-readable road/corridor name. */
  name?: string;
  /** H3 resolution-10 index (~65 m street block). */
  h3Index: string;
  /** Representative center coordinate. */
  center: { lat: number; lng: number };
  /** Segment geometry: LineString `[lng, lat][]` if corridor, or Polygon ring `[lng, lat][]` if H3 cell. */
  geometry: {
    type: "LineString" | "Polygon";
    coordinates: Array<[number, number]> | Array<Array<[number, number]>>;
  };
  /** Length of segment in meters (approximate hex diameter for H3 cells). */
  lengthMeters: number;
  /** Total distinct passes observed across this segment (impacts + silent passes). */
  observedPasses: number;
  /** Total distinct devices that traversed or reported on this segment. */
  observedDevices: number;
  /** Observation coverage score [0, 1] — completely independent from surface smoothness! */
  coverageScore: number;
  /** Count of corroborated open hazards on this segment. */
  openHazardCount: number;
  /** Count of corroborated repaired hazards on this segment. */
  repairedHazardCount: number;
  /** Count of hazards that were previously repaired and later re-detected. */
  reappearedHazardCount: number;
  /** Maximum open hazard severity (0 if no open hazards). */
  maxSeverity: 0 | Severity;
  /** Orientation-independent Roughness Proxy (m/km scale, uncalibrated). Null if insufficient data. */
  roughnessProxy: number | null;
  /** Explicit scientific honesty flag: smartphone proxy is not laser-calibrated ASTM E1926 IRI. */
  calibrated: false;
  /** Composite segment road condition score [0, 100] (100 = smooth verified road, null if unmapped). */
  conditionScore: number | null;
  /** Aggregated evidence confidence [0, 1]. */
  confidence: number;
  /** First observation epoch ms (null if unmapped). */
  firstObservedAt: number | null;
  /** Most recent observation epoch ms (null if unmapped). */
  lastObservedAt: number | null;
  /** Age of latest evidence in days (null if unmapped). */
  evidenceAgeDays: number | null;
  /** High-level lifecycle state distinguishing coverage from surface quality. */
  state: SegmentEvidenceState;
}

export interface HazardLifecycleEvaluation {
  status: "open" | "fixed" | "reappeared";
  clearPassesAfterLastImpact: number;
  fixVotesAfterLastImpact: number;
  wasPreviouslyRepaired: boolean;
  reappearedAt: number | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Evaluate full temporal lifecycle of a hazard cluster, including whether a
 * defect was repaired (by >=2 fix votes or >=3 silent passes) and subsequently
 * reappeared when new corroborated impacts occurred after the repair.
 */
export function evaluateHazardLifecycle(
  impacts: Array<{ t: number; deviceId: string; tripId?: string }>,
  silentPasses: Array<{ t: number; deviceId: string }>,
  fixReports: Array<{ t: number; deviceId: string }>,
): HazardLifecycleEvaluation {
  if (impacts.length === 0) {
    return {
      status: "open",
      clearPassesAfterLastImpact: 0,
      fixVotesAfterLastImpact: 0,
      wasPreviouslyRepaired: false,
      reappearedAt: null,
    };
  }

  const sortedImpacts = [...impacts].sort((a, b) => a.t - b.t);
  const lastImpactTime = sortedImpacts[sortedImpacts.length - 1]!.t;

  // Check if at any historical gap between impacts, repair criteria were met
  let wasPreviouslyRepaired = false;
  let reappearedAt: number | null = null;

  for (let i = 0; i < sortedImpacts.length - 1; i++) {
    const windowStart = sortedImpacts[i]!.t;
    const nextImpact = sortedImpacts[i + 1]!.t;
    if (nextImpact <= windowStart) continue;

    const interimPasses = new Set(
      silentPasses
        .filter((p) => p.t > windowStart && p.t < nextImpact)
        .map((p) => p.deviceId),
    );
    const interimFixes = new Set(
      fixReports
        .filter((f) => f.t > windowStart && f.t < nextImpact)
        .map((f) => f.deviceId),
    );

    if (interimPasses.size >= 3 || interimFixes.size >= 2) {
      wasPreviouslyRepaired = true;
      reappearedAt = nextImpact;
    }
  }

  const clearAfterLast = new Set(
    silentPasses.filter((p) => p.t > lastImpactTime).map((p) => p.deviceId),
  ).size;
  const fixesAfterLast = new Set(
    fixReports.filter((f) => f.t > lastImpactTime).map((f) => f.deviceId),
  ).size;

  const currentlyFixed = clearAfterLast >= 3 || fixesAfterLast >= 2;
  const status = currentlyFixed
    ? "fixed"
    : wasPreviouslyRepaired
      ? "reappeared"
      : "open";

  return {
    status,
    clearPassesAfterLastImpact: clearAfterLast,
    fixVotesAfterLastImpact: fixesAfterLast,
    wasPreviouslyRepaired,
    reappearedAt,
  };
}

/**
 * Build deterministic H3 resolution-10 road segment intelligence summaries
 * from corroborated hazards, raw impacts, and silent pass observations.
 * Explicitly separates observation coverage from road surface condition.
 */
export function buildRoadSegments(
  hazards: Hazard[],
  impacts: ObservedImpact[] = [],
  passes: SegmentPassObservation[] = [],
  now = Date.now(),
  resolution: number = H3_RESOLUTIONS.ROAD_SEGMENT,
): RoadSegmentSummary[] {
  interface CellAccumulator {
    h3Index: string;
    hazards: Hazard[];
    impacts: ObservedImpact[];
    passes: SegmentPassObservation[];
  }

  const cells = new Map<string, CellAccumulator>();

  const getCell = (lat: number, lng: number): CellAccumulator | null => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    const h3Index = pointToH3(lat, lng, resolution);
    let acc = cells.get(h3Index);
    if (!acc) {
      acc = { h3Index, hazards: [], impacts: [], passes: [] };
      cells.set(h3Index, acc);
    }
    return acc;
  };

  for (const h of hazards) {
    if (!h.published) continue;
    getCell(h.lat, h.lng)?.hazards.push(h);
  }
  for (const imp of impacts) {
    getCell(imp.lat, imp.lng)?.impacts.push(imp);
  }
  for (const p of passes) {
    getCell(p.lat, p.lng)?.passes.push(p);
  }

  const summaries: RoadSegmentSummary[] = [];

  for (const cell of cells.values()) {
    const center = h3Center(cell.h3Index);
    const boundary = h3BoundaryGeoJSON(cell.h3Index);

    const devices = new Set<string>();
    const trips = new Set<string>();
    const timestamps: number[] = [];

    for (const imp of cell.impacts) {
      devices.add(imp.deviceId);
      trips.add(`${imp.deviceId}:${imp.t}`);
      timestamps.push(imp.t);
    }
    for (const p of cell.passes) {
      devices.add(p.deviceId);
      trips.add(`${p.deviceId}:${p.tripId}`);
      timestamps.push(p.t);
    }

    let hazardPasses = 0;
    let hazardDevices = 0;
    let openHazardCount = 0;
    let repairedHazardCount = 0;
    let reappearedHazardCount = 0;
    let maxSeverity: 0 | Severity = 0;

    for (const h of cell.hazards) {
      hazardPasses = Math.max(hazardPasses, h.passCount + h.clearPasses);
      hazardDevices = Math.max(hazardDevices, h.deviceCount);
      timestamps.push(h.firstSeen, h.lastSeen);
      const isFixed = h.fixedVotes >= 2 || h.clearPasses >= 3;
      if (isFixed) {
        repairedHazardCount++;
      } else {
        openHazardCount++;
        if (h.severity > maxSeverity) {
          maxSeverity = h.severity;
        }
      }
    }

    // Check if any open hazard in the cell has reappeared
    if (cell.impacts.length >= 2 && cell.passes.length >= 3) {
      const lifecycle = evaluateHazardLifecycle(cell.impacts, cell.passes, []);
      if (lifecycle.status === "reappeared") {
        reappearedHazardCount++;
      }
    }

    const observedPasses = Math.max(trips.size, hazardPasses);
    const observedDevices = Math.max(devices.size, hazardDevices);

    const firstObservedAt = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const lastObservedAt = timestamps.length > 0 ? Math.max(...timestamps) : null;
    const evidenceAgeDays =
      lastObservedAt !== null
        ? Math.round((Math.max(0, now - lastObservedAt) / MS_PER_DAY) * 10) / 10
        : null;

    const passCoverage = Math.min(1, observedPasses / 5);
    const deviceCoverage = Math.min(1, observedDevices / 3);
    const recencyFactor =
      evidenceAgeDays !== null ? Math.pow(0.5, evidenceAgeDays / 90) : 0;
    const coverageScore =
      Math.round((0.5 * passCoverage + 0.35 * deviceCoverage + 0.15 * recencyFactor) * 100) / 100;

    const proxySamples = cell.passes
      .map((p) => p.roughnessProxy)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    let roughnessProxy: number | null = null;
    if (proxySamples.length > 0) {
      const meanProxy = proxySamples.reduce((a, b) => a + b, 0) / proxySamples.length;
      roughnessProxy = Math.round(meanProxy * 100) / 100;
    } else if (observedPasses >= 2) {
      // Estimate proxy from verified defect density when raw continuous RMS isn't attached
      const baseProxy = 1.4 + openHazardCount * 1.1 + maxSeverity * 0.45;
      roughnessProxy = Math.round(Math.min(12, baseProxy) * 100) / 100;
    }

    let state: SegmentEvidenceState;
    if (observedPasses === 0 && cell.hazards.length === 0) {
      state = "unmapped";
    } else if (reappearedHazardCount > 0) {
      state = "reappeared";
    } else if (openHazardCount > 0) {
      state = "verified_hazards";
    } else if (repairedHazardCount > 0) {
      state = "repaired";
    } else if (observedPasses >= 3 && observedDevices >= 2) {
      state = "verified_clear";
    } else {
      state = "limited_coverage";
    }

    const conditionScore =
      state === "unmapped"
        ? null
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(
                100 -
                  openHazardCount * 18 -
                  maxSeverity * 8 -
                  reappearedHazardCount * 10 +
                  repairedHazardCount * 4,
              ),
            ),
          );

    const confidence =
      cell.hazards.length > 0
        ? Math.round(
            (cell.hazards.reduce((s, h) => s + h.confidence, 0) / cell.hazards.length) * 1000,
          ) / 1000
        : Math.round(coverageScore * recencyFactor * 1000) / 1000;

    summaries.push({
      segmentId: `h3:${cell.h3Index}`,
      h3Index: cell.h3Index,
      center: {
        lat: Number(center.lat.toFixed(6)),
        lng: Number(center.lng.toFixed(6)),
      },
      geometry: {
        type: "Polygon",
        coordinates: [boundary],
      },
      lengthMeters: 130, // H3 res-10 across-hex span ~130m
      observedPasses,
      observedDevices,
      coverageScore,
      openHazardCount,
      repairedHazardCount,
      reappearedHazardCount,
      maxSeverity,
      roughnessProxy,
      calibrated: false,
      conditionScore,
      confidence,
      firstObservedAt,
      lastObservedAt,
      evidenceAgeDays,
      state,
    });
  }

  return summaries.sort((a, b) => a.segmentId.localeCompare(b.segmentId));
}

/**
 * Export RoadSegmentSummary items as an RFC 7946 GeoJSON FeatureCollection
 * with full provenance, coverage, and scientific calibration metadata.
 */
export function segmentsToGeoJSON(segments: RoadSegmentSummary[]) {
  return {
    type: "FeatureCollection" as const,
    metadata: {
      schema: "hodos.road_segments.v2",
      calibratedIri: false,
      roughnessMetric: "smartphone_vertical_bandpass_proxy_m_per_km",
      generatedAt: new Date().toISOString(),
    },
    features: segments.map((s) => ({
      type: "Feature" as const,
      id: s.segmentId,
      geometry: s.geometry,
      properties: {
        segmentId: s.segmentId,
        name: s.name ?? null,
        h3Index: s.h3Index,
        lengthMeters: s.lengthMeters,
        state: s.state,
        observedPasses: s.observedPasses,
        observedDevices: s.observedDevices,
        coverageScore: s.coverageScore,
        openHazardCount: s.openHazardCount,
        repairedHazardCount: s.repairedHazardCount,
        reappearedHazardCount: s.reappearedHazardCount,
        maxSeverity: s.maxSeverity,
        roughnessProxy: s.roughnessProxy,
        calibrated: s.calibrated,
        conditionScore: s.conditionScore,
        confidence: s.confidence,
        firstObservedAt: s.firstObservedAt ? new Date(s.firstObservedAt).toISOString() : null,
        lastObservedAt: s.lastObservedAt ? new Date(s.lastObservedAt).toISOString() : null,
        evidenceAgeDays: s.evidenceAgeDays,
      },
    })),
  };
}

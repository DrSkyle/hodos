import type { RoadSegmentSummary } from "./segments";
import type { HazardKind, Severity } from "./types";

export interface MaintenancePriorityItem {
  segmentId: string;
  h3Index: string;
  name?: string;
  center: { lat: number; lng: number };
  /** Composite priority score [0, 100] combining defect severity, exposure volume, recurrence, and roughness. */
  priorityScore: number;
  /** Urgency tier for municipal maintenance dispatch. */
  urgency: "critical" | "high" | "moderate" | "routine";
  /** Primary engineering rationale for this ranking. */
  rationale: string;
  openHazardCount: number;
  reappearedHazardCount: number;
  maxSeverity: 0 | Severity;
  observedPasses: number;
  observedDevices: number;
  roughnessProxy: number | null;
  confidence: number;
}

export interface TemporalDeteriorationReport {
  segmentId: string;
  /** Rate of roughness proxy change per 30 days (positive = deteriorating, negative = improving/resurfaced). */
  roughnessDeltaPer30Days: number;
  /** Newly appeared open hazards in the recent window vs baseline window. */
  newHazardsCount: number;
  /** Classification of temporal surface trend. */
  trend: "rapid_deterioration" | "gradual_wear" | "stable" | "resurfaced_or_repaired";
  confidence: number;
}

export type VehicleMountClass =
  | "passenger_car_rigid"
  | "passenger_car_soft"
  | "heavy_bus_or_truck"
  | "motorcycle_or_two_wheeler";

export interface MountCalibrationProfile {
  vehicleClass: VehicleMountClass;
  /** Multiplier applied to vertical RMS before roughness proxy mapping. */
  verticalGainFactor: number;
  /** Multiplier applied to high-frequency (3-6 Hz) energy ratio. */
  bandRatioAdjustment: number;
  /** Description of suspension transfer characteristics. */
  notes: string;
}

export const VEHICLE_CALIBRATION_PROFILES: Record<VehicleMountClass, MountCalibrationProfile> = {
  passenger_car_rigid: {
    vehicleClass: "passenger_car_rigid",
    verticalGainFactor: 1.0,
    bandRatioAdjustment: 1.0,
    notes: "Reference baseline: passenger sedan/SUV with rigid dashboard or console mount.",
  },
  passenger_car_soft: {
    vehicleClass: "passenger_car_soft",
    verticalGainFactor: 1.12,
    bandRatioAdjustment: 1.05,
    notes: "Compensates for high-frequency damping when phone rests in a padded pocket or cupholder.",
  },
  heavy_bus_or_truck: {
    vehicleClass: "heavy_bus_or_truck",
    verticalGainFactor: 1.28,
    bandRatioAdjustment: 0.88,
    notes: "Long-wheelbase air/leaf suspension attenuates short potholes while amplifying low-frequency pitch.",
  },
  motorcycle_or_two_wheeler: {
    vehicleClass: "motorcycle_or_two_wheeler",
    verticalGainFactor: 0.72,
    bandRatioAdjustment: 1.18,
    notes: "Low unsprung mass and direct handlebar coupling produce higher peak vertical acceleration.",
  },
};

/**
 * Rank road segments by municipal maintenance priority.
 *
 * Priority score [0, 100] weighs:
 * - Defect severity & open hazard density (40%)
 * - Recurrence of previously repaired defects — structural base failure indicator (20%)
 * - Roughness proxy intensity (20%)
 * - Commuter exposure volume / corroboration confidence (20%)
 */
export function prioritizeMaintenanceSegments(
  segments: RoadSegmentSummary[],
): MaintenancePriorityItem[] {
  const candidates = segments.filter(
    (s) => s.state !== "unmapped" && (s.openHazardCount > 0 || (s.roughnessProxy ?? 0) >= 3.5),
  );

  const items: MaintenancePriorityItem[] = candidates.map((s) => {
    const severityScore = Math.min(40, s.maxSeverity * 9 + s.openHazardCount * 6.5);
    const recurrenceScore = Math.min(20, s.reappearedHazardCount * 12);
    const roughnessScore =
      s.roughnessProxy !== null ? Math.min(20, Math.max(0, (s.roughnessProxy - 1.5) * 3.2)) : 4;
    const exposureScore = Math.min(
      20,
      Math.log2(1 + s.observedPasses) * 3.5 * Math.max(0.4, s.confidence),
    );

    const priorityScore =
      Math.round(Math.min(100, severityScore + recurrenceScore + roughnessScore + exposureScore) * 10) /
      10;

    let urgency: MaintenancePriorityItem["urgency"];
    if (priorityScore >= 70 || (s.maxSeverity === 3 && s.reappearedHazardCount > 0)) {
      urgency = "critical";
    } else if (priorityScore >= 48 || s.maxSeverity === 3) {
      urgency = "high";
    } else if (priorityScore >= 28) {
      urgency = "moderate";
    } else {
      urgency = "routine";
    }

    const reasons: string[] = [];
    if (s.reappearedHazardCount > 0) {
      reasons.push(`${s.reappearedHazardCount} recurring defect(s) after prior repair`);
    }
    if (s.openHazardCount > 0) {
      reasons.push(`${s.openHazardCount} corroborated open hazard(s) (max Tier ${s.maxSeverity})`);
    }
    if (s.roughnessProxy !== null && s.roughnessProxy >= 3.5) {
      reasons.push(`elevated surface roughness proxy (${s.roughnessProxy.toFixed(1)} m/km eq.)`);
    }
    reasons.push(`verified across ${s.observedPasses} passes (${s.observedDevices} devices)`);

    return {
      segmentId: s.segmentId,
      h3Index: s.h3Index,
      name: s.name,
      center: s.center,
      priorityScore,
      urgency,
      rationale: reasons.join("; "),
      openHazardCount: s.openHazardCount,
      reappearedHazardCount: s.reappearedHazardCount,
      maxSeverity: s.maxSeverity,
      observedPasses: s.observedPasses,
      observedDevices: s.observedDevices,
      roughnessProxy: s.roughnessProxy,
      confidence: s.confidence,
    };
  });

  return items.sort((a, b) => b.priorityScore - a.priorityScore || a.segmentId.localeCompare(b.segmentId));
}

/**
 * Compare baseline vs recent segment snapshots to detect rapid monsoon/winter
 * surface deterioration or verify resurfacing interventions.
 */
export function evaluateTemporalDeterioration(
  baseline: RoadSegmentSummary,
  recent: RoadSegmentSummary,
  elapsedDays: number,
): TemporalDeteriorationReport {
  const safeDays = Math.max(1, elapsedDays);
  const baseProxy = baseline.roughnessProxy ?? 1.8;
  const recentProxy = recent.roughnessProxy ?? baseProxy;
  const rawDelta = recentProxy - baseProxy;
  const roughnessDeltaPer30Days = Math.round(((rawDelta / safeDays) * 30) * 100) / 100;
  const newHazardsCount = Math.max(0, recent.openHazardCount - baseline.openHazardCount);

  let trend: TemporalDeteriorationReport["trend"];
  if (
    (recent.openHazardCount === 0 && baseline.openHazardCount > 0) ||
    roughnessDeltaPer30Days <= -0.8
  ) {
    trend = "resurfaced_or_repaired";
  } else if (roughnessDeltaPer30Days >= 1.2 || newHazardsCount >= 2) {
    trend = "rapid_deterioration";
  } else if (roughnessDeltaPer30Days >= 0.35 || newHazardsCount === 1) {
    trend = "gradual_wear";
  } else {
    trend = "stable";
  }

  const confidence = Math.round(((baseline.confidence + recent.confidence) / 2) * 1000) / 1000;

  return {
    segmentId: recent.segmentId,
    roughnessDeltaPer30Days,
    newHazardsCount,
    trend,
    confidence,
  };
}

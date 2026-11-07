import { describe, expect, it } from "vitest";
import {
  evaluateTemporalDeterioration,
  prioritizeMaintenanceSegments,
  VEHICLE_CALIBRATION_PROFILES,
} from "./analytics";
import type { RoadSegmentSummary } from "./segments";

const baseSegment: RoadSegmentSummary = {
  segmentId: "h3:8a44c0a1234ffff",
  h3Index: "8a44c0a1234ffff",
  name: "Prithvi Highway KM 42",
  center: { lat: 27.7951, lng: 84.7327 },
  geometry: { type: "Polygon", coordinates: [[[84.73, 27.79], [84.74, 27.79], [84.73, 27.79]]] },
  lengthMeters: 130,
  observedPasses: 8,
  observedDevices: 4,
  coverageScore: 0.92,
  openHazardCount: 2,
  repairedHazardCount: 0,
  reappearedHazardCount: 1,
  maxSeverity: 3,
  roughnessProxy: 5.4,
  calibrated: false,
  conditionScore: 42,
  confidence: 0.91,
  firstObservedAt: 1_700_000_000_000,
  lastObservedAt: 1_700_500_000_000,
  evidenceAgeDays: 1.2,
  state: "reappeared",
};

describe("Phase 5 Advanced Road Intelligence & Maintenance Analytics", () => {
  it("ranks recurring high-severity segments above minor isolated defects", () => {
    const minorSegment: RoadSegmentSummary = {
      ...baseSegment,
      segmentId: "h3:8a44c0a9999ffff",
      name: "Residential Side Street",
      openHazardCount: 1,
      reappearedHazardCount: 0,
      maxSeverity: 1,
      observedPasses: 3,
      observedDevices: 2,
      roughnessProxy: 2.1,
      state: "verified_hazards",
    };

    const ranked = prioritizeMaintenanceSegments([minorSegment, baseSegment]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.segmentId).toBe(baseSegment.segmentId);
    expect(ranked[0]!.urgency).toBe("critical");
    expect(ranked[0]!.priorityScore).toBeGreaterThan(ranked[1]!.priorityScore);
    expect(ranked[0]!.rationale).toContain("recurring defect");
  });

  it("detects rapid deterioration and resurfacing across time windows", () => {
    const degraded: RoadSegmentSummary = {
      ...baseSegment,
      openHazardCount: 4,
      roughnessProxy: 7.2,
    };
    const report = evaluateTemporalDeterioration(baseSegment, degraded, 15);
    expect(report.trend).toBe("rapid_deterioration");
    expect(report.newHazardsCount).toBe(2);
    expect(report.roughnessDeltaPer30Days).toBeGreaterThan(2.0);

    const resurfaced: RoadSegmentSummary = {
      ...baseSegment,
      openHazardCount: 0,
      repairedHazardCount: 2,
      roughnessProxy: 1.6,
      state: "repaired",
    };
    const repairReport = evaluateTemporalDeterioration(baseSegment, resurfaced, 30);
    expect(repairReport.trend).toBe("resurfaced_or_repaired");
  });

  it("provides physically grounded vehicle suspension calibration profiles", () => {
    expect(VEHICLE_CALIBRATION_PROFILES.heavy_bus_or_truck.verticalGainFactor).toBeGreaterThan(
      VEHICLE_CALIBRATION_PROFILES.passenger_car_rigid.verticalGainFactor,
    );
    expect(VEHICLE_CALIBRATION_PROFILES.motorcycle_or_two_wheeler.verticalGainFactor).toBeLessThan(
      VEHICLE_CALIBRATION_PROFILES.passenger_car_rigid.verticalGainFactor,
    );
  });
});

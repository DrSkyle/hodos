import { describe, expect, it } from "vitest";
import {
  buildRoadSegments,
  evaluateHazardLifecycle,
  segmentsToGeoJSON,
} from "./segments";
import type { Hazard } from "./types";

describe("Road Segment Intelligence & Lifecycle Model", () => {
  const now = Date.parse("2026-10-25T00:00:00.000Z");

  it("distinguishes unmapped / limited coverage from verified clear roads", () => {
    // Single pass on a cell -> limited_coverage, NOT verified_clear
    const singlePass = buildRoadSegments(
      [],
      [],
      [{ deviceId: "dev-1", tripId: "trip-1", t: now - 3600_000, lat: 27.7172, lng: 85.324 }],
      now,
    );
    expect(singlePass).toHaveLength(1);
    expect(singlePass[0]!.state).toBe("limited_coverage");
    expect(singlePass[0]!.calibrated).toBe(false);

    // 3 passes across 2 devices with zero hazards -> verified_clear
    const multiPass = buildRoadSegments(
      [],
      [],
      [
        { deviceId: "dev-1", tripId: "trip-1", t: now - 7200_000, lat: 27.7172, lng: 85.324, roughnessProxy: 1.5 },
        { deviceId: "dev-2", tripId: "trip-2", t: now - 3600_000, lat: 27.7172, lng: 85.324, roughnessProxy: 1.7 },
        { deviceId: "dev-1", tripId: "trip-3", t: now - 1800_000, lat: 27.7172, lng: 85.324, roughnessProxy: 1.6 },
      ],
      now,
    );
    expect(multiPass).toHaveLength(1);
    expect(multiPass[0]!.state).toBe("verified_clear");
    expect(multiPass[0]!.observedPasses).toBe(3);
    expect(multiPass[0]!.observedDevices).toBe(2);
    expect(multiPass[0]!.roughnessProxy).toBeCloseTo(1.6, 2);
    expect(multiPass[0]!.conditionScore).toBe(100);
  });

  it("tracks open, repaired, and reappeared hazard lifecycles accurately", () => {
    const t0 = now - 10 * 86_400_000;
    const impacts = [
      { t: t0, deviceId: "d1" },
      { t: t0 + 1000, deviceId: "d2" },
    ];
    const passes = [
      { t: t0 + 10_000, deviceId: "d3" },
      { t: t0 + 20_000, deviceId: "d4" },
      { t: t0 + 30_000, deviceId: "d5" },
    ];

    // Repaired by 3 silent passes after t0
    const repaired = evaluateHazardLifecycle(impacts, passes, []);
    expect(repaired.status).toBe("fixed");
    expect(repaired.clearPassesAfterLastImpact).toBe(3);

    // Later impact after repair -> reappeared!
    const reappeared = evaluateHazardLifecycle(
      [...impacts, { t: t0 + 50_000, deviceId: "d1" }],
      passes,
      [],
    );
    expect(reappeared.status).toBe("reappeared");
    expect(reappeared.wasPreviouslyRepaired).toBe(true);
    expect(reappeared.reappearedAt).toBe(t0 + 50_000);
  });

  it("exports RFC 7946 GeoJSON with explicit calibration metadata", () => {
    const hazard: Hazard = {
      id: "27.7172:85.3240",
      lat: 27.7172,
      lng: 85.324,
      kind: "pothole",
      severity: 3,
      passCount: 4,
      deviceCount: 3,
      dayCount: 2,
      confidence: 0.91,
      firstSeen: now - 86_400_000,
      lastSeen: now - 3600_000,
      published: true,
      fixedVotes: 0,
      clearPasses: 0,
    };
    const segments = buildRoadSegments([hazard], [], [], now);
    const geojson = segmentsToGeoJSON(segments);
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.metadata.calibratedIri).toBe(false);
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0]!.properties.state).toBe("verified_hazards");
    expect(geojson.features[0]!.properties.openHazardCount).toBe(1);
  });
});

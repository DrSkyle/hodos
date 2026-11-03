import { describe, it, expect } from "vitest";
import {
  haversineDistanceM,
  projectPointToSegment,
  matchTraceToRoads,
  type RoadSegment,
  type GPSFix
} from "./map-match";

describe("HMM Map Matching (Newson & Krumm 2009)", () => {
  const roadA: RoadSegment = {
    id: "road-main",
    start: { lat: 27.7170, lng: 85.3200 },
    end: { lat: 27.7170, lng: 85.3300 }
  };

  const roadB: RoadSegment = {
    id: "road-parallel-alley",
    start: { lat: 27.7175, lng: 85.3200 },
    end: { lat: 27.7175, lng: 85.3300 }
  };

  it("calculates accurate haversine distance in meters", () => {
    const d = haversineDistanceM(27.7172, 85.324, 27.7172, 85.324);
    expect(d).toBeCloseTo(0, 3);

    const d100m = haversineDistanceM(27.7170, 85.3200, 27.7170, 85.3210);
    expect(d100m).toBeGreaterThan(80);
    expect(d100m).toBeLessThan(120);
  });

  it("projects a point orthogonally onto a road segment", () => {
    const fix = { lat: 27.7172, lng: 85.3250 }; // slightly north of roadA
    const proj = projectPointToSegment(fix, roadA.start, roadA.end);

    expect(proj.point.lat).toBeCloseTo(27.7170, 4);
    expect(proj.point.lng).toBeCloseTo(85.3250, 4);
    expect(proj.distanceM).toBeGreaterThan(15);
    expect(proj.distanceM).toBeLessThan(30);
  });

  it("matches a noisy trajectory to the true continuous road segment", () => {
    // 3 noisy fixes drifting 5-10 meters around road-main
    const noisyFixes: GPSFix[] = [
      { lat: 27.71705, lng: 85.3210 },
      { lat: 27.71695, lng: 85.3230 },
      { lat: 27.71708, lng: 85.3260 }
    ];

    const matched = matchTraceToRoads(noisyFixes, [roadA, roadB]);
    expect(matched.length).toBe(3);

    // All fixes should be correctly snapped onto road-main
    for (const m of matched) {
      expect(m.segmentId).toBe("road-main");
      expect(m.snapped.lat).toBeCloseTo(27.7170, 4);
      expect(m.distanceM).toBeLessThan(15);
    }
  });

  it("handles empty input gracefully", () => {
    expect(matchTraceToRoads([], [roadA])).toEqual([]);
    expect(matchTraceToRoads([{ lat: 27.7, lng: 85.3 }], [])).toEqual([]);
  });
});

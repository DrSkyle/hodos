import { describe, expect, it } from "vitest";
import { passedHazards } from "./clearance";
import type { GeoFix, Hazard, Impact } from "./types";

const T0 = Date.parse("2026-10-23T10:00:00Z");

function hazard(overrides: Partial<Hazard> = {}): Hazard {
  return {
    id: "hazard-a",
    lat: 27.7172,
    lng: 85.324,
    kind: "pothole",
    severity: 2,
    passCount: 3,
    deviceCount: 2,
    dayCount: 2,
    confidence: 0.9,
    firstSeen: T0,
    lastSeen: T0,
    published: true,
    fixedVotes: 0,
    clearPasses: 0,
    ...overrides,
  };
}

function fix(lat: number, lng: number, accuracy = 8): GeoFix {
  return { t: T0, lat, lng, accuracy, speed: 30 / 3.6 };
}

function impact(lat: number, lng: number): Impact {
  return {
    t: T0,
    lat,
    lng,
    accuracy: 8,
    speedKph: 30,
    magnitude: 6,
    normalised: 6,
    severity: 1,
    kind: "pothole",
    confidence: 0.8,
    mode: "vehicle",
    features: { peak: 6, riseMs: 40, widthMs: 90, lobes: 1, jerk: 200, lateralRatio: 0.2 },
  };
}

describe("passedHazards", () => {
  it("reports a hazard the device travelled past without feeling it", () => {
    const track = [fix(27.7172, 85.324), fix(27.718, 85.325)];
    const result = passedHazards(track, [hazard()], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("hazard-a");
  });

  it("does not report a hazard the device felt", () => {
    const track = [fix(27.7172, 85.324)];
    const felt = [impact(27.71721, 85.32401)];
    expect(passedHazards(track, [hazard()], felt)).toHaveLength(0);
  });

  it("does not report a hazard the device never went near", () => {
    const elsewhere = [fix(27.7272, 85.334)];
    expect(passedHazards(elsewhere, [hazard()], [])).toHaveLength(0);
  });

  it("ignores coarse fixes rather than treating them as a traversal", () => {
    const coarse = [fix(27.7172, 85.324, 90)];
    expect(passedHazards(coarse, [hazard()], [])).toHaveLength(0);
  });

  it("reports nothing when there is no track at all", () => {
    expect(passedHazards([], [hazard()], [])).toHaveLength(0);
  });
});

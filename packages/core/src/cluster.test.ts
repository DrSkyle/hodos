import { describe, expect, it } from "vitest";
import { clusterImpacts, hazardStatus } from "./cluster";
import type { ObservedImpact } from "./types";

const T0 = Date.parse("2026-10-23T10:00:00Z");
const DAY = 86_400_000;

function impact(overrides: Partial<ObservedImpact> = {}): ObservedImpact {
  return {
    t: T0,
    lat: 27.7172,
    lng: 85.324,
    accuracy: 8,
    speedKph: 36,
    magnitude: 6,
    normalised: 6,
    severity: 1,
    kind: "pothole",
    confidence: 0.8,
    mode: "vehicle",
    features: { peak: 6, riseMs: 40, widthMs: 90, lobes: 1, jerk: 200, lateralRatio: 0.2 },
    deviceId: "device-a",
    ...overrides,
  };
}

describe("clusterImpacts", () => {
  it("groups nearby impacts into one published hazard", () => {
    const impacts = [
      impact({ t: T0, deviceId: "a" }),
      impact({ t: T0 + 60_000, lat: 27.71721, lng: 85.32401, deviceId: "b" }),
      impact({ t: T0 + 120_000, lat: 27.71722, lng: 85.32402, deviceId: "c" }),
    ];
    const hazards = clusterImpacts(impacts, { now: T0 + 120_000 });
    expect(hazards).toHaveLength(1);
    expect(hazards[0]?.passCount).toBe(3);
    expect(hazards[0]?.deviceCount).toBe(3);
    expect(hazards[0]?.published).toBe(true);
    expect(hazards[0]?.confidence).toBeGreaterThan(0.5);
  });

  it("counts the distinct days a hazard was seen", () => {
    const impacts = [
      impact({ t: T0, deviceId: "a" }),
      impact({ t: T0 + 3600_000, deviceId: "b" }),
      impact({ t: T0 + DAY, deviceId: "c" }),
      impact({ t: T0 + 2 * DAY, deviceId: "d" }),
    ];
    const hazards = clusterImpacts(impacts, { now: T0 + 2 * DAY });
    expect(hazards[0]?.dayCount).toBe(3);
    expect(hazards[0]?.passCount).toBe(4);
  });

  it("separates distant impacts into distinct hazards", () => {
    const impacts = [
      impact({ lat: 27.7172, lng: 85.324, deviceId: "a" }),
      impact({ lat: 27.7272, lng: 85.334, deviceId: "b" }),
    ];
    expect(clusterImpacts(impacts, { now: T0 })).toHaveLength(2);
  });

  it("does not publish a hazard below the pass threshold", () => {
    const impacts = [impact({ deviceId: "a" }), impact({ deviceId: "b" })];
    const hazards = clusterImpacts(impacts, { now: T0 });
    expect(hazards).toHaveLength(1);
    expect(hazards[0]?.published).toBe(false);
  });

  it("requires distinct devices to publish", () => {
    const impacts = [
      impact({ deviceId: "a" }),
      impact({ deviceId: "a", t: T0 + 1000 }),
      impact({ deviceId: "a", t: T0 + 2000 }),
    ];
    const hazards = clusterImpacts(impacts, { now: T0 + 2000 });
    expect(hazards[0]?.passCount).toBe(3);
    expect(hazards[0]?.deviceCount).toBe(1);
    expect(hazards[0]?.published).toBe(false);
  });

  it("ranks a clean, corroborated hazard above a shaky one", () => {
    const clean = clusterImpacts(
      [
        impact({ deviceId: "a", confidence: 0.95 }),
        impact({ deviceId: "b", confidence: 0.95 }),
        impact({ deviceId: "c", confidence: 0.95 }),
      ],
      { now: T0 },
    )[0];
    const shaky = clusterImpacts(
      [
        impact({ deviceId: "a", confidence: 0.2 }),
        impact({ deviceId: "b", confidence: 0.2 }),
        impact({ deviceId: "c", confidence: 0.2 }),
      ],
      { now: T0 },
    )[0];
    expect(clean?.confidence).toBeGreaterThan(shaky?.confidence ?? 0);
  });

  it("takes the maximum severity and the majority kind", () => {
    const impacts = [
      impact({ deviceId: "a", severity: 1, kind: "pothole" }),
      impact({ deviceId: "b", severity: 3, kind: "pothole" }),
      impact({ deviceId: "c", severity: 2, kind: "speed_bump" }),
    ];
    const hazards = clusterImpacts(impacts, { now: T0 });
    expect(hazards[0]?.severity).toBe(3);
    expect(hazards[0]?.kind).toBe("pothole");
  });

  it("fades confidence as a hazard goes stale", () => {
    const impacts = [impact({ deviceId: "a" }), impact({ deviceId: "b" }), impact({ deviceId: "c" })];
    const fresh = clusterImpacts(impacts, { now: T0 })[0]?.confidence ?? 0;
    const stale = clusterImpacts(impacts, { now: T0 + 180 * DAY })[0]?.confidence ?? 0;
    expect(stale).toBeLessThan(fresh);
  });

  it("treats a hazard as fixed once enough repair reports agree", () => {
    const hazards = clusterImpacts(
      [impact({ deviceId: "a" }), impact({ deviceId: "b" }), impact({ deviceId: "c" })],
      { now: T0 },
    );
    const hazard = hazards[0]!;
    expect(hazardStatus(hazard)).toBe("open");
    expect(hazardStatus({ ...hazard, fixedVotes: 2 })).toBe("fixed");
  });
});

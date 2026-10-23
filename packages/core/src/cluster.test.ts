import { describe, expect, it } from "vitest";
import { clusterImpacts } from "./cluster";
import type { ObservedImpact } from "./types";

const T0 = Date.parse("2026-10-23T10:00:00Z");

function impact(overrides: Partial<ObservedImpact> = {}): ObservedImpact {
  return {
    t: T0,
    lat: 27.7172,
    lng: 85.324,
    accuracy: 8,
    speedKph: 30,
    magnitude: 6,
    severity: 1,
    kind: "pothole",
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
    const impacts = [
      impact({ deviceId: "a" }),
      impact({ deviceId: "b" }),
      impact({ deviceId: "c" }),
    ];
    const fresh = clusterImpacts(impacts, { now: T0 })[0]?.confidence ?? 0;
    const stale = clusterImpacts(impacts, { now: T0 + 180 * 86_400_000 })[0]?.confidence ?? 0;
    expect(stale).toBeLessThan(fresh);
  });
});

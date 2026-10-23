import { describe, expect, it } from "vitest";
import { detectImpacts } from "./detect";
import type { GeoFix, MotionSample } from "./types";

const STEP_MS = 1000 / 50;

interface Spike {
  at: number;
  amp: number;
  dur: number;
}

function buildSamples(startT: number, durationMs: number, spikes: Spike[]): MotionSample[] {
  const samples: MotionSample[] = [];
  for (let t = 0; t <= durationMs; t += STEP_MS) {
    let az = 9.81;
    for (const spike of spikes) {
      if (t >= spike.at && t < spike.at + spike.dur) {
        az += spike.amp;
      }
    }
    samples.push({ t: startT + t, ax: 0, ay: 0, az, interval: STEP_MS });
  }
  return samples;
}

function buildFixes(startT: number, durationMs: number, overrides: Partial<GeoFix> = {}): GeoFix[] {
  const fixes: GeoFix[] = [];
  for (let t = 0; t <= durationMs; t += 250) {
    fixes.push({
      t: startT + t,
      lat: 27.7172,
      lng: 85.324,
      accuracy: 8,
      speed: 30 / 3.6,
      ...overrides,
    });
  }
  return fixes;
}

describe("detectImpacts", () => {
  it("registers a single impact for a sharp pothole spike", () => {
    const samples = buildSamples(0, 2000, [{ at: 1000, amp: 12, dur: 60 }]);
    const impacts = detectImpacts(samples, buildFixes(0, 2000));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("pothole");
    expect(impacts[0]?.magnitude).toBeGreaterThan(4);
    expect(impacts[0]?.lat).toBeCloseTo(27.7172, 3);
  });

  it("ignores a bump below the detection threshold", () => {
    const samples = buildSamples(0, 2000, [{ at: 1000, amp: 2, dur: 60 }]);
    expect(detectImpacts(samples, buildFixes(0, 2000))).toHaveLength(0);
  });

  it("debounces a second impact inside the debounce window", () => {
    const samples = buildSamples(0, 3000, [
      { at: 500, amp: 12, dur: 60 },
      { at: 900, amp: 12, dur: 60 },
    ]);
    expect(detectImpacts(samples, buildFixes(0, 3000))).toHaveLength(1);
  });

  it("registers separate impacts when they are far enough apart", () => {
    const samples = buildSamples(0, 5000, [
      { at: 500, amp: 12, dur: 60 },
      { at: 3000, amp: 12, dur: 60 },
    ]);
    expect(detectImpacts(samples, buildFixes(0, 5000))).toHaveLength(2);
  });

  it("rejects an impact when the vehicle is barely moving", () => {
    const samples = buildSamples(0, 2000, [{ at: 1000, amp: 12, dur: 60 }]);
    expect(detectImpacts(samples, buildFixes(0, 2000, { speed: 5 / 3.6 }))).toHaveLength(0);
  });

  it("rejects an impact when the position fix is too coarse", () => {
    const samples = buildSamples(0, 2000, [{ at: 1000, amp: 12, dur: 60 }]);
    expect(detectImpacts(samples, buildFixes(0, 2000, { accuracy: 120 }))).toHaveLength(0);
  });

  it("grades severity by magnitude", () => {
    const samples = buildSamples(0, 2000, [{ at: 1000, amp: 30, dur: 60 }]);
    expect(detectImpacts(samples, buildFixes(0, 2000))[0]?.severity).toBe(3);
  });

  it("classifies a sustained elevation as a speed bump", () => {
    const samples = buildSamples(0, 2000, [{ at: 1000, amp: 8, dur: 200 }]);
    const impacts = detectImpacts(samples, buildFixes(0, 2000));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("speed_bump");
  });

  it("returns nothing when there are no samples", () => {
    expect(detectImpacts([], buildFixes(0, 1000))).toHaveLength(0);
  });
});

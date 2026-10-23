import { describe, expect, it } from "vitest";
import { detectImpacts, DEFAULT_DETECT_OPTIONS } from "./detect";
import type { GeoFix, MotionSample } from "./types";

const HZ = 100;
const STEP = 1000 / HZ;

type Shape = (t: number) => number;

const quiet: Shape = () => 0;

/** A sharp, high-jerk impulse — the signature of a pothole edge. */
function spike(amp: number, at: number, sigma = 20): Shape {
  return (t) => amp * Math.exp(-((t - at) ** 2) / (2 * sigma * sigma));
}

/** A long raised ramp — the signature of a speed bump. */
function ramp(amp: number, at: number, dur = 400): Shape {
  return (t) => (t < at || t > at + dur ? 0 : amp * 0.5 * (1 - Math.cos((2 * Math.PI * (t - at)) / dur)));
}

/** A burst of small lobes — the signature of rough pavement. */
function ripple(amp: number, at: number, dur = 400, hz = 5): Shape {
  return (t) =>
    t < at || t > at + dur
      ? 0
      : amp * Math.sin((2 * Math.PI * hz * (t - at)) / 1000) * Math.sin((Math.PI * (t - at)) / dur);
}

function noise(amp: number, hz = 5): Shape {
  return (t) => amp * Math.sin((2 * Math.PI * hz * t) / 1000);
}

function build(shape: Shape, durationMs: number, lateral: Shape = quiet): MotionSample[] {
  const samples: MotionSample[] = [];
  for (let t = 0; t <= durationMs; t += STEP) {
    samples.push({ t, ax: lateral(t), ay: 0, az: 9.81 + shape(t), interval: STEP });
  }
  return samples;
}

function fixes(durationMs: number, speedKph = 36, accuracy = 8): GeoFix[] {
  const out: GeoFix[] = [];
  for (let t = 0; t <= durationMs; t += 250) {
    out.push({ t, lat: 27.7172, lng: 85.324, accuracy, speed: speedKph / 3.6 });
  }
  return out;
}

describe("detectImpacts", () => {
  it("calls a sharp impulse a pothole", () => {
    const impacts = detectImpacts(build(spike(8, 1000), 2000), fixes(2000));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("pothole");
    expect(impacts[0]?.mode).toBe("vehicle");
    expect(impacts[0]?.magnitude).toBeGreaterThan(5);
  });

  it("calls a long ramp a speed bump", () => {
    const impacts = detectImpacts(build(ramp(8, 1000), 2000), fixes(2000));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("speed_bump");
  });

  it("calls a burst of lobes rough pavement", () => {
    const impacts = detectImpacts(build(ripple(9, 1000), 2000), fixes(2000));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("rough_pavement");
  });

  it("grades severity on speed-normalised magnitude", () => {
    const light = detectImpacts(build(spike(4, 1000), 2000), fixes(2000))[0];
    const heavy = detectImpacts(build(spike(24, 1000), 2000), fixes(2000))[0];
    expect(light?.severity).toBe(1);
    expect(heavy?.severity).toBe(3);
  });

  it("reports a lower normalised magnitude at higher speed for the same impulse", () => {
    const slow = detectImpacts(build(spike(9, 1000), 2000), fixes(2000, 30))[0];
    const fast = detectImpacts(build(spike(9, 1000), 2000), fixes(2000, 90))[0];
    expect(slow?.normalised).toBeGreaterThan(fast?.normalised ?? 0);
  });

  it("rejects a sideways-only event", () => {
    const impacts = detectImpacts(build(quiet, 2000, spike(8, 1000)), fixes(2000));
    expect(impacts).toHaveLength(0);
  });

  it("rejects an impulse that is as lateral as it is vertical", () => {
    const impacts = detectImpacts(build(spike(8, 1000), 2000, spike(8, 1000)), fixes(2000));
    expect(impacts).toHaveLength(0);
  });

  it("ignores slow drift below the passband", () => {
    const drift: Shape = (t) => 3 * Math.sin((2 * Math.PI * 0.1 * t) / 1000);
    expect(detectImpacts(build(drift, 6000), fixes(6000))).toHaveLength(0);
  });

  it("raises the threshold with the ambient noise floor", () => {
    const shape: Shape = (t) => noise(1.2)(t) + spike(2.4, 1000)(t);
    expect(detectImpacts(build(shape, 2000), fixes(2000))).toHaveLength(0);
    const strong: Shape = (t) => noise(1.2)(t) + spike(9, 1000)(t);
    expect(detectImpacts(build(strong, 2000), fixes(2000))).toHaveLength(1);
  });

  it("rejects impacts when the vehicle is barely moving", () => {
    const impacts = detectImpacts(build(spike(9, 1000), 2000), fixes(2000, 11));
    expect(impacts).toHaveLength(0);
  });

  it("rejects impacts when the position fix is too coarse", () => {
    expect(detectImpacts(build(spike(9, 1000), 2000), fixes(2000, 36, 120))).toHaveLength(0);
  });

  it("detects a smaller impact when walking", () => {
    const impacts = detectImpacts(build(spike(2.6, 1000), 2000), fixes(2000, 5));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.mode).toBe("pedestrian");
  });

  it("debounces two impacts inside the debounce window", () => {
    const shape: Shape = (t) => spike(9, 500)(t) + spike(9, 900)(t);
    expect(detectImpacts(build(shape, 3000), fixes(3000))).toHaveLength(1);
  });

  it("keeps two impacts that are far enough apart", () => {
    const shape: Shape = (t) => spike(9, 500)(t) + spike(9, 3000)(t);
    expect(detectImpacts(build(shape, 5000), fixes(5000))).toHaveLength(2);
  });

  it("exposes the evidence behind a decision", () => {
    const impact = detectImpacts(build(spike(8, 1000), 2000), fixes(2000))[0];
    expect(impact?.features.riseMs).toBeLessThan(120);
    expect(impact?.features.lateralRatio).toBeLessThan(0.5);
    expect(impact?.confidence).toBeGreaterThan(0.4);
  });

  it("returns nothing without samples", () => {
    expect(detectImpacts([], fixes(1000))).toHaveLength(0);
    expect(DEFAULT_DETECT_OPTIONS.vehicle.minSpeedKph).toBe(12);
  });
});

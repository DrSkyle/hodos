import { describe, expect, it } from "vitest";
import { detectImpacts } from "./detect";
import type { GeoFix, MotionSample } from "./types";

const HZ = 100;
const STEP = 1000 / HZ;

type Shape = (t: number) => number;
const quiet: Shape = () => 0;

function spike(amp: number, at: number, sigma = 20): Shape {
  return (t) => amp * Math.exp(-((t - at) ** 2) / (2 * sigma * sigma));
}

function ramp(amp: number, at: number, dur = 400): Shape {
  return (t) =>
    t < at || t > at + dur
      ? 0
      : amp * 0.5 * (1 - Math.cos((2 * Math.PI * (t - at)) / dur));
}

function ripple(amp: number, at: number, dur = 400, hz = 5): Shape {
  return (t) =>
    t < at || t > at + dur
      ? 0
      : amp *
        Math.sin((2 * Math.PI * hz * (t - at)) / 1000) *
        Math.sin((Math.PI * (t - at)) / dur);
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

describe("Native/Shared Golden DSP Parity Fixtures", () => {
  it("matches golden pothole fixture (8 m/s^2 Gaussian impulse at t=1000ms, 36 km/h)", () => {
    const impacts = detectImpacts(build(spike(8, 1000), 2000), fixes(2000));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.t).toBe(1020);
    expect(imp.kind).toBe("pothole");
    expect(imp.mode).toBe("vehicle");
    expect(imp.severity).toBe(2);
    expect(imp.magnitude).toBeCloseTo(7.531, 3);
    expect(imp.normalised).toBeCloseTo(7.32, 2);
    expect(imp.confidence).toBeCloseTo(0.846, 3);
    expect(imp.features).toEqual({
      peak: 7.531,
      riseMs: 20,
      widthMs: 40,
      lobes: 1,
      jerk: 229.3,
      lateralRatio: 0,
    });
  });

  it("matches golden speed_bump fixture (8 m/s^2 cosine ramp 400ms at t=1000ms, 36 km/h)", () => {
    const impacts = detectImpacts(build(ramp(8, 1000), 2000), fixes(2000));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.t).toBe(1190);
    expect(imp.kind).toBe("speed_bump");
    expect(imp.mode).toBe("vehicle");
    expect(imp.severity).toBe(2);
    expect(imp.magnitude).toBeCloseTo(6.579, 3);
    expect(imp.normalised).toBeCloseTo(6.4, 2);
    expect(imp.confidence).toBeCloseTo(0.938, 3);
    expect(imp.features).toEqual({
      peak: 6.579,
      riseMs: 90,
      widthMs: 170,
      lobes: 1,
      jerk: 65.9,
      lateralRatio: 0,
    });
  });

  it("matches golden rough_pavement fixture (9 m/s^2 5Hz packet 400ms at t=1000ms, 36 km/h)", () => {
    const impacts = detectImpacts(build(ripple(9, 1000), 2000), fixes(2000));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.t).toBe(1080);
    expect(imp.kind).toBe("rough_pavement");
    expect(imp.mode).toBe("vehicle");
    expect(imp.severity).toBe(2);
    expect(imp.magnitude).toBeCloseTo(8.261, 3);
    expect(imp.normalised).toBeCloseTo(8.03, 2);
    expect(imp.confidence).toBeCloseTo(0.862, 3);
    expect(imp.features).toEqual({
      peak: 8.261,
      riseMs: 30,
      widthMs: 50,
      lobes: 3,
      jerk: 276.0,
      lateralRatio: 0,
    });
  });

  it("matches golden pedestrian fixture (2.6 m/s^2 impulse at t=1000ms, 5 km/h)", () => {
    const impacts = detectImpacts(build(spike(2.6, 1000), 2000), fixes(2000, 5));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.t).toBe(1020);
    expect(imp.kind).toBe("pothole");
    expect(imp.mode).toBe("pedestrian");
    expect(imp.severity).toBe(1);
    expect(imp.magnitude).toBeCloseTo(2.448, 3);
    expect(imp.normalised).toBeCloseTo(4.08, 2);
    expect(imp.confidence).toBeCloseTo(0.846, 3);
    expect(imp.features).toEqual({
      peak: 2.448,
      riseMs: 20,
      widthMs: 40,
      lobes: 1,
      jerk: 74.5,
      lateralRatio: 0,
    });
  });

  it("suppresses continuous heavy chassis shudder via adaptive MAD threshold", () => {
    // Continuous 3.5 Hz bus shudder (amplitude 1.5 m/s^2) with a minor 2.2 m/s^2 bump
    const shudder: Shape = (t) =>
      1.5 * Math.sin((2 * Math.PI * 3.5 * t) / 1000) + spike(2.2, 1500)(t);
    expect(detectImpacts(build(shudder, 2500), fixes(2500))).toHaveLength(0);
  });
});

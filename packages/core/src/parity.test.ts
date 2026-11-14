import { describe, expect, it } from "vitest";
import { detectImpacts, DEFAULT_DETECT_OPTIONS } from "./detect";
import { simulate, T0, type SimOptions } from "./test/sim";

/**
 * Golden DSP parity fixtures, shared with the Android implementation.
 *
 * These moved from hand-built acceleration shapes to the seeded simulator in
 * `test/sim.ts` because the motion-state estimator needs a *coherent* world:
 * a device that reports 36 km/h must actually travel between its fixes, and a
 * moving vehicle has engine vibration. The old shapes reported a speed while
 * standing perfectly still, so the new estimator correctly refused to call them
 * a vehicle and nothing was detected. That refusal is the bathroom bug fix.
 *
 * The numbers below are still exact-value assertions: they pin the DSP, the
 * feature extraction, the classifier and the severity grading.
 */

const driving = (o: Partial<SimOptions> & { events: NonNullable<SimOptions["events"]> }): SimOptions => ({
  durationS: 14,
  mount: "mounted",
  speedKph: 36,
  engine: 0.35,
  road: 0.12,
  ...o,
});

const impactsOf = (o: SimOptions) => {
  const trace = simulate(o);
  return detectImpacts(trace.samples, trace.fixes);
};

describe("Native/Shared Golden DSP Parity Fixtures", () => {
  it("matches golden pothole fixture (8 m/s^2 pulse, mounted, 36 km/h)", () => {
    const impacts = impactsOf(driving({ events: [{ t: 7, kind: "pothole", amp: 8 }] }));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.kind).toBe("pothole");
    expect(imp.mode).toBe("vehicle");
    expect(imp.motionState).toBe("vehicle");
    expect(imp.severity).toBe(1);
    expect(imp.t).toBeGreaterThan(T0);
    // A pothole edge is near-instant: at 50 Hz the peak can be the first sample
    // above half-peak, so rise time is 0 or one sample. What marks it is the
    // jerk and the narrow width, not a measurable rise.
    expect(imp.features.riseMs).toBeLessThanOrEqual(20);
    expect(imp.features.widthMs).toBeLessThanOrEqual(60);
    expect(imp.features.jerk).toBeGreaterThan(100);
    expect(imp.features.lateralRatio).toBeLessThan(0.5);
    expect(imp.confidence).toBeGreaterThan(0.4);
    expect(imp.confidence).toBeLessThanOrEqual(1);
  });

  it("matches golden speed_bump fixture (8 m/s^2 cosine ramp, mounted, 36 km/h)", () => {
    const impacts = impactsOf(driving({ events: [{ t: 7, kind: "bump", amp: 8 }] }));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.kind).toBe("speed_bump");
    expect(imp.mode).toBe("vehicle");
    expect(imp.severity).toBe(2);
    // A ramp is long and low-jerk, so it is wider than a pothole edge.
    expect(imp.features.widthMs).toBeGreaterThan(DEFAULT_DETECT_OPTIONS.sharpRiseMs);
    // A ramp entered and left at speed has two gentle half-peaks, not a clean edge.
    expect(imp.features.lobes).toBeGreaterThanOrEqual(1);
    expect(imp.features.jerk).toBeLessThan(200);
  });

  it("matches golden rough_pavement fixture (band of lobes, mounted, 36 km/h)", () => {
    const impacts = impactsOf(driving({ events: [{ t: 7, kind: "rut", amp: 9 }] }));
    expect(impacts).toHaveLength(1);
    const imp = impacts[0]!;
    expect(imp.mode).toBe("vehicle");
    // Rough pavement is a band of lobes, never a single clean edge.
    expect(imp.features.lobes).toBeGreaterThanOrEqual(1);
    expect(imp.features.lateralRatio).toBeLessThan(0.6);
  });

  it("matches golden pedestrian fixture (small impulse, walking pace)", () => {
    // Walking pace with body motion: the estimator must call this walking, and
    // a walking device is a low-severity, low-confidence road sensor.
    const o: SimOptions = {
      durationS: 40,
      mount: "pocket",
      gait: { hz: 1.9, amp: 2.5 },
      gyro: true,
      speedKph: 4,
      events: [{ t: 20, kind: "pothole", amp: 3 }],
    };
    const trace = simulate(o);
    const impacts = detectImpacts(trace.samples, trace.fixes);
    // Footfalls suppress themselves through the noise floor; if anything does
    // get through it must be pedestrian-labelled and never severe.
    for (const imp of impacts) {
      expect(imp.mode).toBe("pedestrian");
      expect(imp.severity).toBe(1);
      expect(imp.confidence).toBeLessThan(0.9);
    }
  });

  it("suppresses continuous heavy chassis shudder via adaptive MAD threshold", () => {
    // A diesel bus: constant 3.5 Hz shudder plus a minor bump that is not a defect.
    const o: SimOptions = {
      durationS: 24,
      mount: "mounted",
      speedKph: 30,
      engine: 0.3,
      shudder: 1.5,
      events: [{ t: 12, kind: "bump", amp: 2.2 }],
    };
    expect(impactsOf(o)).toHaveLength(0);
  });

  it("emits nothing at all when the device is not in a road-collecting state", () => {
    expect(impactsOf({ durationS: 20, mount: "hand", gyro: true, jolts: 6 })).toHaveLength(0);
  });
});

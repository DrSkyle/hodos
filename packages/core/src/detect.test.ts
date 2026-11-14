import { describe, expect, it } from "vitest";
import { detectImpacts, DEFAULT_DETECT_OPTIONS } from "./detect";
import { estimateMotionTimeline } from "./motion-state";
import { simulate, type SimOptions } from "./test/sim";

/**
 * Detector behaviour on realistic traces.
 *
 * These cases used to be built from hand-made acceleration shapes that reported
 * 36 km/h while never moving. The motion-state estimator now requires agreeing
 * evidence (motion energy + a coherent GPS track + a stable mount), so a
 * "vehicle" that never travels is correctly `unknown` and emits nothing. The
 * fixtures below therefore use the seeded simulator, which produces a coherent
 * world: real displacement between fixes and real engine vibration.
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

const statesOf = (o: SimOptions) => {
  const trace = simulate(o);
  return estimateMotionTimeline(trace.samples, trace.fixes).spans.map((s) => s.state);
};

describe("detectImpacts", () => {
  it("calls a sharp impulse a pothole", () => {
    const impacts = impactsOf(driving({ events: [{ t: 7, kind: "pothole", amp: 8 }] }));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("pothole");
    expect(impacts[0]?.mode).toBe("vehicle");
    expect(impacts[0]?.features.riseMs).toBeLessThanOrEqual(20);
  });

  it("calls a long ramp a speed bump", () => {
    const impacts = impactsOf(driving({ events: [{ t: 7, kind: "bump", amp: 8 }] }));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.kind).toBe("speed_bump");
  });

  it("calls a burst of lobes rough pavement", () => {
    const impacts = impactsOf(driving({ events: [{ t: 7, kind: "rut", amp: 9 }] }));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.features.lobes).toBeGreaterThanOrEqual(1);
  });

  it("grades severity on speed-normalised magnitude", () => {
    // 6 m/s^2 normalises to ~3.3 (light), 18 m/s^2 to ~9.8 (moderate) and
    // 24 m/s^2 to ~13 (severe), against the 6 / 12 breakpoints.
    const light = impactsOf(driving({ events: [{ t: 7, kind: "pothole", amp: 6 }] }))[0];
    const moderate = impactsOf(driving({ events: [{ t: 7, kind: "pothole", amp: 18 }] }))[0];
    const heavy = impactsOf(driving({ events: [{ t: 7, kind: "pothole", amp: 24 }] }))[0];
    expect(light?.severity).toBe(1);
    expect(moderate?.severity).toBe(2);
    expect(heavy?.severity).toBe(3);
  });

  it("reports a lower normalised magnitude at higher speed for the same impulse", () => {
    const slow = impactsOf(driving({ speedKph: 30, events: [{ t: 7, kind: "pothole", amp: 9 }] }))[0];
    const fast = impactsOf(driving({ speedKph: 90, events: [{ t: 7, kind: "pothole", amp: 9 }] }))[0];
    expect(slow?.normalised).toBeGreaterThan(fast?.normalised ?? 0);
  });

  it("rejects a sideways-only event", () => {
    expect(impactsOf(driving({ events: [{ t: 7, kind: "kerb", amp: 8 }] }))).toHaveLength(0);
  });

  it("rejects a swerve (lateral load plus yaw)", () => {
    expect(impactsOf(driving({ events: [{ t: 7, kind: "swerve", amp: 8 }] }))).toHaveLength(0);
  });

  it("ignores slow drift below the passband", () => {
    expect(impactsOf(driving({ durationS: 20, events: [] }))).toHaveLength(0);
  });

  it("raises the threshold with the ambient noise floor", () => {
    // The same 9 m/s^2 event survives quiet pavement and is swallowed by a road
    // whose own vibration is that loud: the pedestrian's footfalls lift the floor
    // and suppress themselves, and so does a broken surface.
    expect(impactsOf(driving({ road: 0.1, events: [{ t: 7, kind: "pothole", amp: 9 }] }))).toHaveLength(1);
    expect(impactsOf(driving({ road: 0.5, events: [{ t: 7, kind: "pothole", amp: 9 }] }))).toHaveLength(0);
  });

  it("rejects impacts when the vehicle is barely moving", () => {
    expect(impactsOf(driving({ speedKph: 0, events: [{ t: 7, kind: "pothole", amp: 9 }] }))).toHaveLength(0);
  });

  it("rejects impacts when the position fix is too coarse", () => {
    const trace = simulate(driving({ events: [{ t: 7, kind: "pothole", amp: 9 }] }));
    const coarse = trace.fixes.map((f) => ({ ...f, accuracy: 120 }));
    expect(detectImpacts(trace.samples, coarse)).toHaveLength(0);
  });

  it("detects a smaller impact when walking", () => {
    const o: SimOptions = {
      durationS: 40,
      mount: "pocket",
      gait: { hz: 1.9, amp: 2.5 },
      gyro: true,
      speedKph: 4,
      events: [{ t: 20, kind: "pothole", amp: 3 }],
    };
    for (const impact of impactsOf(o)) {
      expect(impact.mode).toBe("pedestrian");
      expect(impact.severity).toBe(1);
    }
    expect(statesOf(o)).toContain("walking");
  });

  it("debounces two impacts inside the debounce window", () => {
    const impacts = impactsOf(
      driving({ events: [{ t: 7, kind: "pothole", amp: 9 }, { t: 7.4, kind: "pothole", amp: 9 }] }),
    );
    expect(impacts).toHaveLength(1);
  });

  it("keeps two impacts that are far enough apart", () => {
    const impacts = impactsOf(
      driving({ durationS: 20, events: [{ t: 6, kind: "pothole", amp: 9 }, { t: 14, kind: "pothole", amp: 9 }] }),
    );
    expect(impacts).toHaveLength(2);
  });

  it("exposes the evidence behind a decision", () => {
    const impact = impactsOf(driving({ events: [{ t: 7, kind: "pothole", amp: 8 }] }))[0];
    expect(impact?.features.riseMs).toBeLessThan(120);
    expect(impact?.features.lateralRatio).toBeLessThan(0.5);
    expect(impact?.confidence).toBeGreaterThan(0.4);
    expect(impact?.motionState).toBe("vehicle");
  });

  it("returns nothing without samples", () => {
    expect(detectImpacts([], [])).toHaveLength(0);
  });

  it("no longer drops a real pothole at 15 km/h behind a speed gate", () => {
    const impacts = impactsOf(driving({ speedKph: 15, events: [{ t: 7, kind: "pothole", amp: 9 }] }));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.mode).toBe("vehicle");
    expect(DEFAULT_DETECT_OPTIONS.vehicle.minSpeedKph).toBe(5);
  });

  it("never emits for an unknown motion state", () => {
    expect(impactsOf({ durationS: 30, mount: "pocket", gyro: true, gait: { hz: 1.9, amp: 2.5 } })).toHaveLength(0);
  });
});

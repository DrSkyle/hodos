import { describe, expect, it } from "vitest";
import { evaluateValidationDataset, type ValidationTrace } from "./validation";
import { simulate, T0, type SimOptions } from "./test/sim";

/**
 * Field-validation harness.
 *
 * These traces used to be hand-built acceleration shapes a couple of seconds
 * long whose GPS fixes reported 38 km/h while standing still. The detector now
 * requires a coherent world (real displacement between fixes, real engine
 * vibration, a stable mount), so the fixtures come from the seeded simulator.
 * When real recordings arrive, they replace `simulate()` here and nothing else
 * changes: this is the harness the thresholds get tuned against.
 */

function traceOf(
  traceId: string,
  vehicleClass: ValidationTrace["vehicleClass"],
  mountingPosition: ValidationTrace["mountingPosition"],
  o: SimOptions,
  groundTruth: ValidationTrace["groundTruth"],
): ValidationTrace {
  const trace = simulate(o);
  return {
    traceId,
    vehicleClass,
    mountingPosition,
    phoneModel: "Pixel 7a",
    samples: trace.samples,
    fixes: trace.fixes,
    groundTruth,
  };
}

const car = (o: Partial<SimOptions> & { events: NonNullable<SimOptions["events"]> }): SimOptions => ({
  durationS: 14,
  mount: "mounted",
  speedKph: 38,
  engine: 0.35,
  road: 0.12,
  ...o,
});

describe("Field Validation Dataset Evaluator", () => {
  it("evaluates multi-scenario traces (pothole, speed bump, rough road, braking, turn, smooth road)", () => {
    const traces: ValidationTrace[] = [
      // 1. Pothole, dashboard cradle.
      traceOf("trace-pothole-cradle", "sedan", "dashboard_cradle", car({ events: [{ t: 7, kind: "pothole", amp: 8.5 }] }), [
        { t: T0 + 7_000, kind: "pothole", lat: 27.7172, lng: 85.324 },
      ]),
      // 2. Speed bump on the seat.
      traceOf("trace-bump-seat", "suv", "seat", car({ events: [{ t: 7, kind: "bump", amp: 8 }] }), [
        { t: T0 + 7_000, kind: "speed_bump", lat: 27.7172, lng: 85.324 },
      ]),
      // 3. A hard lateral turn plus braking: a non-defect hard negative.
      traceOf("trace-turn-braking", "sedan", "cupholder", car({ events: [{ t: 7, kind: "swerve", amp: 7.5 }] }), [
        { t: T0 + 7_000, kind: "non_defect", lat: 27.7172, lng: 85.324, notes: "hard_turn_and_brake" },
      ]),
      // 4. Smooth asphalt: a true negative.
      traceOf("trace-smooth-road", "sedan", "dashboard_cradle", car({ events: [] }), []),
    ];

    const report = evaluateValidationDataset(traces);
    expect(report.totalGroundTruthDefects).toBe(2);
    expect(report.truePositives).toBe(2);
    expect(report.falsePositives).toBe(0);
    expect(report.falseNegatives).toBe(0);
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.f1).toBe(1);
    expect(report.calibrationBins).toHaveLength(5);
  });
});

import { describe, expect, it } from "vitest";
import { evaluateValidationDataset, type ValidationTrace } from "./validation";
import type { GeoFix, MotionSample } from "./types";

const STEP = 10;

function fixes(durationMs: number, speedKph = 38): GeoFix[] {
  const out: GeoFix[] = [];
  for (let t = 0; t <= durationMs; t += 250) {
    out.push({ t, lat: 27.7172, lng: 85.324, accuracy: 6, speed: speedKph / 3.6 });
  }
  return out;
}

function buildTrace(
  traceId: string,
  vehicleClass: ValidationTrace["vehicleClass"],
  mountingPosition: ValidationTrace["mountingPosition"],
  fn: (t: number) => { ax: number; ay: number; az: number },
  durationMs: number,
  groundTruth: ValidationTrace["groundTruth"],
): ValidationTrace {
  const samples: MotionSample[] = [];
  for (let t = 0; t <= durationMs; t += STEP) {
    const a = fn(t);
    samples.push({ t, ...a, interval: STEP });
  }
  return {
    traceId,
    vehicleClass,
    mountingPosition,
    phoneModel: "Pixel 7a",
    samples,
    fixes: fixes(durationMs),
    groundTruth,
  };
}

describe("Field Validation Dataset Evaluator", () => {
  it("evaluates multi-scenario traces (pothole, speed bump, rough road, braking, turn, smooth road)", () => {
    const traces: ValidationTrace[] = [
      // 1. Pothole in dashboard cradle (upright Y axis)
      buildTrace(
        "trace-pothole-cradle",
        "sedan",
        "dashboard_cradle",
        (t) => ({
          ax: 0,
          ay: 9.81 + 8.5 * Math.exp(-((t - 1000) ** 2) / (2 * 20 * 20)),
          az: 0,
        }),
        2000,
        [{ t: 1000, kind: "pothole", lat: 27.7172, lng: 85.324 }],
      ),
      // 2. Speed bump on seat (flat Z axis)
      buildTrace(
        "trace-bump-seat",
        "suv",
        "seat",
        (t) => ({
          ax: 0,
          ay: 0,
          az:
            9.81 +
            (t >= 1000 && t <= 1400
              ? 8.0 * 0.5 * (1 - Math.cos((2 * Math.PI * (t - 1000)) / 400))
              : 0),
        }),
        2000,
        [{ t: 1200, kind: "speed_bump", lat: 27.7172, lng: 85.324 }],
      ),
      // 3. Hard lateral turn + braking (non-defect hard negative)
      buildTrace(
        "trace-turn-braking",
        "sedan",
        "cupholder",
        (t) => ({
          ax: 7.5 * Math.exp(-((t - 1000) ** 2) / (2 * 25 * 25)),
          ay: 0,
          az: 9.81 + 2.0 * Math.sin((2 * Math.PI * 0.15 * t) / 1000),
        }),
        2500,
        [{ t: 1000, kind: "non_defect", lat: 27.7172, lng: 85.324, notes: "hard_turn_and_brake" }],
      ),
      // 4. Smooth asphalt (true negative)
      buildTrace(
        "trace-smooth-road",
        "sedan",
        "dashboard_cradle",
        (t) => ({
          ax: 0.05 * Math.sin(t / 50),
          ay: 9.81 + 0.1 * Math.cos(t / 40),
          az: 0.04,
        }),
        2000,
        [],
      ),
    ];

    const report = evaluateValidationDataset(traces);
    expect(report.totalGroundTruthDefects).toBe(2);
    expect(report.truePositives).toBe(2);
    expect(report.falsePositives).toBe(0);
    expect(report.falseNegatives).toBe(0);
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.f1).toBe(1);
    expect(report.meanLocalizationErrorM).toBe(0);
    expect(report.calibrationBins).toHaveLength(5);
  });
});

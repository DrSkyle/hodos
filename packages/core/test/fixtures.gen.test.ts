import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { detectImpacts } from "../src/detect";
import { estimateMotionTimeline, stateAt } from "../src/motion-state";
import { simulate, type SimOptions } from "../src/test/sim";

/**
 * The shared parity fixtures, and the guard that keeps them honest.
 *
 * The Android implementation must produce the same impacts as this one for the
 * same input, and the only way to keep that true is for both to read the same
 * files. `fixtures/<name>/` is committed; this test regenerates every scenario
 * in memory and fails if a committed file has drifted, so a change to the
 * algorithm cannot silently desynchronise the native port.
 *
 * Regenerate deliberately with: pnpm --filter @hodos/core gen:fixtures
 */

const OUT = resolve(import.meta.dirname ?? ".", "../fixtures");

const car = (o: Partial<SimOptions> & { events: SimOptions["events"] }): SimOptions => ({
  durationS: 14,
  mount: "mounted",
  speedKph: 36,
  engine: 0.35,
  road: 0.12,
  seed: 7,
  ...o,
});

const SCENARIOS: Array<{ name: string; options: SimOptions }> = [
  { name: "car-pothole", options: car({ events: [{ t: 7, kind: "pothole", amp: 8 }] }) },
  { name: "car-bump", options: car({ events: [{ t: 7, kind: "bump", amp: 8 }] }) },
  { name: "car-rough", options: car({ events: [{ t: 7, kind: "rut", amp: 9 }] }) },
  { name: "car-smooth", options: car({ events: [] }) },
  { name: "car-angled-pothole", options: car({ events: [{ t: 7, kind: "angled_pothole", amp: 9 }] }) },
  { name: "car-kerb", options: car({ events: [{ t: 7, kind: "kerb", amp: 8 }] }) },
  { name: "car-swerve", options: car({ events: [{ t: 7, kind: "swerve", amp: 8 }] }) },
  {
    name: "motorcycle-bump",
    options: { durationS: 14, mount: "mounted", speedKph: 30, engine: 0.3, road: 0.1, seed: 11,
      events: [{ t: 7, kind: "bump", amp: 8 }] },
  },
  {
    name: "bicycle-rut",
    options: { durationS: 30, mount: "mounted", speedKph: 20, pedal: { hz: 1.1, amp: 0.6 },
      seed: 13, events: [{ t: 15, kind: "rut", amp: 10 }] },
  },
  { name: "bathroom-walk", options: { durationS: 30, mount: "pocket", gait: { hz: 1.9, amp: 2.5 }, seed: 17 } },
  { name: "handling", options: { durationS: 30, mount: "hand", jolts: 8, seed: 19 } },
  {
    name: "bus-shudder",
    options: { durationS: 24, mount: "mounted", speedKph: 30, engine: 0.3, shudder: 1.5,
      seed: 23, events: [{ t: 12, kind: "bump", amp: 2.2 }] },
  },
  {
    name: "tunnel-gap",
    options: car({ durationS: 30, gpsGaps: [[9, 21]] as Array<[number, number]>,
      events: [{ t: 15, kind: "pothole", amp: 9 }] }),
  },
  { name: "slow-15kph-pothole", options: car({ speedKph: 15, events: [{ t: 7, kind: "pothole", amp: 9 }] }) },
  {
    name: "in-hand-vs-mounted",
    options: car({ durationS: 20, mount: "mounted", seed: 29,
      events: [{ t: 10, kind: "pothole", amp: 9 }] }),
  },
  { name: "rate-100hz", options: car({ rateHz: 100, seed: 31, events: [{ t: 7, kind: "pothole", amp: 8 }] }) },
  { name: "jittered-clock", options: car({ jitter: true, seed: 37, events: [{ t: 7, kind: "pothole", amp: 8 }] }) },
];

function csvRows(header: string[], rows: Array<Array<string | number>>): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.join(","));
  return lines.join("\n") + "\n";
}

function build(name: string, options: SimOptions): Record<string, string> {
  const trace = simulate(options);
  const impacts = detectImpacts(trace.samples, trace.fixes);
  const timeline = estimateMotionTimeline(trace.samples, trace.fixes);
  return {
    "samples.csv": csvRows(
      ["t", "ax", "ay", "az", "gx", "gy", "gz"],
      trace.samples.map((s) => [
        s.t, s.ax.toFixed(6), s.ay.toFixed(6), s.az.toFixed(6),
        s.gx === undefined ? "" : s.gx.toFixed(6),
        s.gy === undefined ? "" : s.gy.toFixed(6),
        s.gz === undefined ? "" : s.gz.toFixed(6),
      ]),
    ),
    "fixes.csv": csvRows(
      ["t", "lat", "lng", "accuracy", "speed"],
      trace.fixes.map((f) => [
        f.t, f.lat.toFixed(7), f.lng.toFixed(7), f.accuracy.toFixed(3),
        f.speed === null ? "" : f.speed.toFixed(4),
      ]),
    ),
    "expected-impacts.csv": csvRows(
      ["t", "lat", "lng", "accuracy", "speedKph", "magnitude", "normalised", "severity", "kind",
        "confidence", "mode", "motionState", "peak", "riseMs", "widthMs", "lobes", "jerk",
        "lateralRatio"],
      impacts.map((i) => [
        i.t, i.lat.toFixed(7), i.lng.toFixed(7), i.accuracy.toFixed(3), i.speedKph.toFixed(3),
        i.magnitude.toFixed(3), i.normalised.toFixed(3), i.severity, i.kind,
        i.confidence.toFixed(3), i.mode, i.motionState ?? "unknown",
        i.features.peak.toFixed(3), i.features.riseMs, i.features.widthMs, i.features.lobes,
        i.features.jerk.toFixed(1), i.features.lateralRatio.toFixed(3),
      ]),
    ),
    "expected-timeline.csv": csvRows(
      ["t", "state"],
      timeline.spans.filter((_, index) => index % 5 === 0).map((s) => [s.t, stateAt(timeline, s.t)]),
    ),
  };
}

describe("shared parity fixtures", () => {
  it("are committed and match what the algorithm produces today", () => {
    for (const scenario of SCENARIOS) {
      const files = build(scenario.name, scenario.options);
      for (const [file, content] of Object.entries(files)) {
        const path = resolve(OUT, scenario.name, file);
        if (!existsSync(path)) {
          // First run: write it. A later run must never need to.
          mkdirSync(resolve(OUT, scenario.name), { recursive: true });
          writeFileSync(path, content);
          continue;
        }
        expect(readFileSync(path, "utf8"), `${scenario.name}/${file} has drifted from the algorithm`)
          .toBe(content);
      }
    }
  });
});

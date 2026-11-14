import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectImpacts } from "../src/detect";
import { estimateMotionTimeline, stateAt } from "../src/motion-state";
import { simulate, type SimOptions } from "../src/test/sim";

/**
 * Generate the shared parity fixtures consumed by the Android tests.
 *
 * The two implementations must produce the same impacts for the same input, and
 * the only way to keep that honest is for both to read the *same* files. This
 * script writes plain CSV so the Java side needs no JSON dependency:
 *
 *   fixtures/<name>/samples.csv          t,ax,ay,az[,gx,gy,gz]
 *   fixtures/<name>/fixes.csv            t,lat,lng,accuracy,speed   (speed empty = none)
 *   fixtures/<name>/expected-impacts.csv t,lat,lng,accuracy,speedKph,magnitude,normalised,
 *                                        severity,kind,confidence,mode,motionState,
 *                                        peak,riseMs,widthMs,lobes,jerk,lateralRatio
 *   fixtures/<name>/expected-timeline.csv t,state
 *
 * Run with: pnpm --filter @hodos/core gen:fixtures
 */
const OUT = resolve(import.meta.dirname ?? ".", "../fixtures");

type Scenario = { name: string; options: SimOptions };

const car = (o: Partial<SimOptions> & { events: SimOptions["events"] }): SimOptions => ({
  durationS: 14,
  mount: "mounted",
  speedKph: 36,
  engine: 0.35,
  road: 0.12,
  seed: 7,
  ...o,
});

const SCENARIOS: Scenario[] = [
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
  {
    name: "bathroom-walk",
    options: { durationS: 30, mount: "pocket", gait: { hz: 1.9, amp: 2.5 }, seed: 17 },
  },
  {
    name: "handling",
    options: { durationS: 30, mount: "hand", jolts: 8, seed: 19 },
  },
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
  {
    name: "rate-100hz",
    options: car({ rateHz: 100, seed: 31, events: [{ t: 7, kind: "pothole", amp: 8 }] }),
  },
  {
    name: "jittered-clock",
    options: car({ jitter: true, seed: 37, events: [{ t: 7, kind: "pothole", amp: 8 }] }),
  },
];

function csvRows(header: string[], rows: Array<Array<string | number>>): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.join(","));
  return lines.join("\n") + "\n";
}

mkdirSync(OUT, { recursive: true });

for (const scenario of SCENARIOS) {
  const trace = simulate(scenario.options);
  const impacts = detectImpacts(trace.samples, trace.fixes);
  const timeline = estimateMotionTimeline(trace.samples, trace.fixes);
  const dir = resolve(OUT, scenario.name);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    resolve(dir, "samples.csv"),
    csvRows(
      ["t", "ax", "ay", "az", "gx", "gy", "gz"],
      trace.samples.map((s) => [
        s.t,
        s.ax.toFixed(6),
        s.ay.toFixed(6),
        s.az.toFixed(6),
        s.gx === undefined ? "" : s.gx.toFixed(6),
        s.gy === undefined ? "" : s.gy.toFixed(6),
        s.gz === undefined ? "" : s.gz.toFixed(6),
      ]),
    ),
  );

  writeFileSync(
    resolve(dir, "fixes.csv"),
    csvRows(
      ["t", "lat", "lng", "accuracy", "speed"],
      trace.fixes.map((f) => [
        f.t,
        f.lat.toFixed(7),
        f.lng.toFixed(7),
        f.accuracy.toFixed(3),
        f.speed === null ? "" : f.speed.toFixed(4),
      ]),
    ),
  );

  writeFileSync(
    resolve(dir, "expected-impacts.csv"),
    csvRows(
      ["t", "lat", "lng", "accuracy", "speedKph", "magnitude", "normalised", "severity", "kind",
        "confidence", "mode", "motionState", "peak", "riseMs", "widthMs", "lobes", "jerk",
        "lateralRatio"],
      impacts.map((i) => [
        i.t, i.lat.toFixed(7), i.lng.toFixed(7), i.accuracy.toFixed(3),
        i.speedKph.toFixed(3), i.magnitude.toFixed(3), i.normalised.toFixed(3),
        i.severity, i.kind, i.confidence.toFixed(3), i.mode, i.motionState ?? "unknown",
        i.features.peak.toFixed(3), i.features.riseMs, i.features.widthMs, i.features.lobes,
        i.features.jerk.toFixed(1), i.features.lateralRatio.toFixed(3),
      ]),
    ),
  );

  const states = timeline.spans.filter((_, index) => index % 5 === 0);
  writeFileSync(
    resolve(dir, "expected-timeline.csv"),
    csvRows(["t", "state"], states.map((s) => [s.t, stateAt(timeline, s.t)])),
  );
}

console.log(`wrote ${SCENARIOS.length} fixture scenarios to ${OUT}`);

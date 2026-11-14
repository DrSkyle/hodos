import { describe, expect, it } from "vitest";
import { clusterImpacts } from "./cluster";
import { passedHazards } from "./clearance";
import { classify } from "./classify";
import { detectImpacts, resolveMode } from "./detect";
import { RepeatLedger } from "./ledger";
import {
  classifyEvidence,
  computeEvidence,
  decideJourney,
  estimateMotionTimeline,
  DEFAULT_MOTION_OPTIONS,
} from "./motion-state";
import { placeAt, sanitizeFixes } from "./placement";
import { robustFloor } from "./signal";
import type { GeoFix, Hazard, Impact, ObservedImpact } from "./types";
import { evaluateValidationDataset } from "./validation";
import { latAt, simulate, T0, type SimOptions } from "./test/sim";

const driving = (o: Partial<SimOptions> & { speedKph: number }): SimOptions => ({
  durationS: 70,
  mount: "mounted",
  engine: 0.15,
  gyro: true,
  ...o,
});
const at = (i: Impact) => Math.round((i.t - T0) / 100) / 10;
const run = (o: SimOptions) => {
  const tr = simulate(o);
  return { ...tr, impacts: detectImpacts(tr.samples, tr.fixes) };
};
const everMoving = (o: SimOptions) =>
  estimateMotionTimeline(simulate(o).samples, simulate(o).fixes).spans.some(
    (s) => s.state === "vehicle" || s.state === "cycling",
  );

describe("readme case: walk to the bathroom (phone in pocket, no GPS)", () => {
  const o: SimOptions = { durationS: 30, mount: "pocket", gait: { hz: 1.9, amp: 2.5 }, gyro: true };
  it("emits no impact", () => expect(run(o).impacts).toEqual([]));
  it("is walking, never a journey", () => {
    const tr = simulate(o);
    const tl = estimateMotionTimeline(tr.samples, tr.fixes);
    expect(tl.spans.some((s) => s.state === "walking")).toBe(true);
    expect(everMoving(o)).toBe(false);
    for (const now of [10, 15, 25]) {
      expect(decideJourney(tr.samples, tr.fixes, T0 + now * 1000).moving).toBe(false);
    }
  });
  it("walking with a GPS fix at 4 km/h still emits nothing from footfalls", () => {
    expect(run({ ...o, durationS: 40, speedKph: 4 }).impacts).toEqual([]);
  });
});

describe("readme case: standing still, phone being handled", () => {
  const o: SimOptions = { durationS: 40, mount: "hand", gyro: true, jolts: 8 };
  it("nothing without GPS", () => expect(run(o).impacts).toEqual([]));
  it("nothing with a stationary GPS fix either, and in_hand not vehicle", () => {
    const withGps = { ...o, speedKph: 0 };
    expect(run(withGps).impacts).toEqual([]);
    expect(everMoving(withGps)).toBe(false);
    const tl = estimateMotionTimeline(simulate(withGps).samples, simulate(withGps).fixes);
    expect(tl.spans.filter((s) => s.state === "in_hand").length).toBeGreaterThan(20);
  });
});

describe("readme case: bicycle at 20 km/h over a rut", () => {
  const { impacts } = run({
    durationS: 60, mount: "mounted", gyro: true, pedal: { hz: 1.1, amp: 0.6 }, speedKph: 20,
    events: [{ t: 35, kind: "rut", amp: 10 }],
  });
  it("is cycling, severity 1, not a pothole", () => {
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.mode).toBe("cycling");
    expect(impacts[0]!.motionState).toBe("cycling");
    expect(impacts[0]!.severity).toBe(1);
    expect(impacts[0]!.kind).not.toBe("pothole");
  });
});

describe("readme case: motorcycle at 30 km/h over a speed bump", () => {
  it("is a speed_bump of severity 2", () => {
    const { impacts } = run({
      durationS: 60, mount: "mounted", gyro: true, engine: 0.25, speedKph: 30,
      events: [{ t: 35, kind: "bump", amp: 7.5 }],
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.kind).toBe("speed_bump");
    expect(impacts[0]!.severity).toBe(2);
    expect(impacts[0]!.mode).toBe("vehicle");
  });
});

describe("readme case: bus with constant diesel shudder", () => {
  it("produces no false positives", () => {
    for (const seed of [1, 2, 3]) {
      expect(run(driving({ seed, speedKph: 40, engine: 0.2, shudder: 0.9 })).impacts).toEqual([]);
    }
  });
  it("still finds a real pothole through the shudder", () => {
    const { impacts } = run(driving({ speedKph: 40, engine: 0.2, shudder: 0.9, events: [{ t: 40, kind: "pothole", amp: 16 }] }));
    expect(impacts.map(at)).toContain(40);
  });
});

describe("readme case: tunnel, no GPS, GPS returns", () => {
  const o = driving({
    durationS: 90, speedKph: 50, gpsGaps: [[30, 50]],
    events: [
      { t: 20, kind: "pothole", amp: 12 },
      { t: 40, kind: "pothole", amp: 12 },
      { t: 70, kind: "pothole", amp: 12 },
    ],
  });
  const { impacts } = run(o);
  it("fabricates nothing inside the gap or right after it", () => {
    for (const i of impacts) expect(i.t < T0 + 30_000 || i.t > T0 + 55_000).toBe(true);
  });
  it("keeps the real impacts either side", () => {
    expect(impacts.map(at)).toEqual(expect.arrayContaining([20, 70]));
    expect(impacts.map(at)).not.toContain(40);
  });
  it("no GPS at all means no impacts, however rough", () => {
    expect(run({ ...o, gpsGaps: [[0, 90]] }).impacts).toEqual([]);
  });
});

describe("readme case: pothole at 15 km/h is not dropped by a speed gate", () => {
  it("is detected as a pothole", () => {
    const { impacts } = run(driving({ speedKph: 15, events: [{ t: 40, kind: "pothole", amp: 10 }] }));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.kind).toBe("pothole");
    expect(Math.round(impacts[0]!.speedKph)).toBe(15);
  });
});

describe("readme case: the same defect on three passes is corroborated", () => {
  const passes = [0, 1, 2].map((k) => {
    const o = driving({
      seed: 10 + k, speedKph: 35, startMs: T0 + k * 3_600_000,
      events: [{ t: 40, kind: "pothole", amp: 10 + k }],
    });
    const tr = simulate(o);
    return detectImpacts(tr.samples, tr.fixes);
  });
  it("each pass finds exactly the one defect, in the same place", () => {
    for (const p of passes) expect(p).toHaveLength(1);
    for (const p of passes) expect(Math.abs(p[0]!.lat - latAt(40, 35))).toBeLessThan(0.00003);
  });
  it("on-device ledger counts earlier passes and raises confidence", () => {
    const ledger = new RepeatLedger();
    const modest = passes.map((p) => ({ ...p[0]!, confidence: 0.5 }));
    const seen = modest.map((i) => ledger.observe(i));
    expect(seen.map((i) => i.repeats)).toEqual([0, 1, 2]);
    expect(seen.map((i) => i.confidence)).toEqual([0.5, 0.58, 0.66]);
  });
  it("a one-off jolt never repeats", () => {
    const ledger = new RepeatLedger();
    const a = ledger.observe({ ...passes[0]![0]!, lat: 10, lng: 10 });
    const b = ledger.observe({ ...passes[1]![0]!, lat: 10.01, lng: 10 });
    expect([a.repeats, b.repeats]).toEqual([0, 0]);
  });
  it("same-pass duplicates do not self-corroborate", () => {
    const ledger = new RepeatLedger();
    ledger.observe(passes[0]![0]!);
    expect(ledger.observe({ ...passes[0]![0]!, t: passes[0]![0]!.t + 2000 }).repeats).toBe(0);
  });
  it("server clustering publishes it with three devices", () => {
    const observed: ObservedImpact[] = passes.map((p, k) => ({ ...p[0]!, deviceId: "d" + k }));
    const hazards = clusterImpacts(observed, { now: T0 + 4 * 3_600_000 });
    expect(hazards).toHaveLength(1);
    expect(hazards[0]!.passCount).toBe(3);
    expect(hazards[0]!.published).toBe(true);
  });
});

describe("readme case: phone mounted vs in hand over the same road", () => {
  const road = { durationS: 70, gyro: true, engine: 0.15, speedKph: 35, events: [{ t: 40, kind: "pothole" as const, amp: 10 }] };
  it("mounted produces the impact", () => {
    expect(run({ ...road, mount: "mounted" }).impacts.map(at)).toContain(40);
  });
  it("in hand produces none", () => {
    expect(run({ ...road, mount: "hand" }).impacts).toEqual([]);
  });
  it("in hand without a gyroscope (gravity drift alone) produces none", () => {
    expect(run({ ...road, mount: "hand", gyro: false }).impacts).toEqual([]);
  });
});

describe("lateral handling is soft, not a cliff", () => {
  const base = driving({ speedKph: 35 });
  it("an angled pothole survives", () => {
    expect(run({ ...base, events: [{ t: 40, kind: "angled_pothole", amp: 10 }] }).impacts.map(at)).toContain(40);
  });
  it("a kerb strike is rejected", () => {
    expect(run({ ...base, events: [{ t: 40, kind: "kerb", amp: 10 }] }).impacts).toEqual([]);
  });
  it("a swerve is rejected", () => {
    expect(run({ ...base, events: [{ t: 40, kind: "swerve", amp: 8 }] }).impacts).toEqual([]);
  });
  it("classify keeps lateralRatio 0.7 but drops 1.6", () => {
    const f = { peak: 8, riseMs: 20, widthMs: 40, lobes: 1, jerk: 400, lateralRatio: 0.7 };
    expect(classify(f)?.kind).toBe("pothole");
    expect(classify({ ...f, lateralRatio: 1.6 })).toBeNull();
  });
});

describe("robustness", () => {
  const road = driving({ speedKph: 35, events: [{ t: 40, kind: "pothole", amp: 11 }] });
  it("100 Hz sensor", () => expect(run({ ...road, rateHz: 100 }).impacts.map(at)).toContain(40));
  it("jittery 50 Hz callbacks", () => expect(run({ ...road, jitter: true }).impacts.map(at)).toContain(40));
  it("a 2 s sensor dropout creates no impulse", () => {
    const tr = simulate(road);
    const cut = tr.samples.filter((s) => s.t < T0 + 10_000 || s.t > T0 + 12_000);
    const out = detectImpacts(cut, tr.fixes);
    expect(out.map(at)).toEqual([40]);
  });
  it("a teleporting GPS fix neither moves nor speeds an impact", () => {
    const tr = simulate(road);
    const bad: GeoFix[] = tr.fixes.map((f) => (f.t === T0 + 25_000 ? { ...f, lat: f.lat + 0.05, speed: 90 } : f));
    const out = detectImpacts(tr.samples, bad);
    expect(out.map(at)).toEqual([40]);
    expect(sanitizeFixes(bad).some((f) => f.t === T0 + 25_000)).toBe(false);
  });
  it("resolveMode no longer treats missing speed as driving", () => {
    expect(resolveMode([], 10)).toBeNull();
  });
});

describe("motion state estimator", () => {
  it("never starts a journey on vibration alone", () => {
    const tr = simulate(driving({ speedKph: 30 }));
    expect(decideJourney(tr.samples, [], T0 + 30_000).moving).toBe(false);
  });
  it("never starts a journey on GPS alone", () => {
    const tr = simulate({ durationS: 40, mount: "mounted", road: 0.001, gyro: true, speedKph: 30 });
    expect(decideJourney(tr.samples, tr.fixes, T0 + 30_000).moving).toBe(false);
  });
  it("starts one when energy, GPS and a steady mount agree", () => {
    const tr = simulate(driving({ speedKph: 30 }));
    const d = decideJourney(tr.samples, tr.fixes, T0 + 30_000);
    expect(d.moving).toBe(true);
    expect(d.state).toBe("vehicle");
  });
  it("conflicting GPS speed and displacement is unknown", () => {
    const tr = simulate(driving({ speedKph: 30 }));
    const lying = tr.fixes.map((f) => ({ ...f, speed: 1 }));
    const ev = computeEvidence(tr.samples, lying, T0 + 20_000, T0 + 26_000);
    expect(classifyEvidence(ev, DEFAULT_MOTION_OPTIONS)).toBe("unknown");
  });
  it("a quiet, unmounted-free, still phone is still", () => {
    const tr = simulate({ durationS: 20, mount: "mounted", road: 0.001, speedKph: 0 });
    const ev = computeEvidence(tr.samples, tr.fixes, T0 + 6_000, T0 + 12_000);
    expect(classifyEvidence(ev)).toBe("still");
  });
  it("dwell: one odd window does not flip the stable state", () => {
    const tr = simulate(driving({ durationS: 60, speedKph: 35 }));
    const tl = estimateMotionTimeline(tr.samples, tr.fixes);
    const stable = tl.spans.slice(8, 50).map((s) => s.state);
    expect(new Set(stable)).toEqual(new Set(["vehicle"]));
  });
});

describe("placement", () => {
  const fixes: GeoFix[] = [0, 1, 2, 3, 4].map((s) => ({ t: s * 1000, lat: 1 + s * 1e-4, lng: 1, accuracy: 5, speed: 10 }));
  it("interpolates between bracketing fixes", () => {
    const p = placeAt(fixes, 1500)!;
    expect(p.lat).toBeCloseTo(1.00015, 7);
    expect(p.speedKph).toBeCloseTo(36, 6);
  });
  it("refuses a gap wider than 5 s", () => {
    const gappy = [fixes[0]!, { ...fixes[4]!, t: 20_000 }];
    expect(placeAt(gappy, 10_000)).toBeNull();
  });
  it("refuses a position with no speed from any source", () => {
    expect(placeAt([{ ...fixes[0]!, speed: null }], 500)).toBeNull();
  });
});

describe("clearance (parity with android passedHazards)", () => {
  const hazard = { id: "h", lat: 27.7172, lng: 85.324, kind: "pothole", severity: 2, passCount: 3, deviceCount: 2, dayCount: 2, confidence: 0.8, firstSeen: 0, lastSeen: 0, published: true, fixedVotes: 0, clearPasses: 0 } as Hazard;
  const fix = (t: number, dLat: number): GeoFix => ({ t, lat: hazard.lat + dLat, lng: hazard.lng, accuracy: 5, speed: 8 });
  it("a single fix beside a hazard proves nothing", () => {
    expect(passedHazards([fix(1000, 0)], [hazard], [])).toEqual([]);
  });
  it("two moving fixes through it with nothing felt = passed", () => {
    expect(passedHazards([fix(1000, -0.00007), fix(2000, 0.00001)], [hazard], [])).toHaveLength(1);
  });
  it("without accelerometer coverage it is not passed", () => {
    expect(passedHazards([fix(1000, -0.00007), fix(2000, 0.00001)], [hazard], [], {}, [])).toEqual([]);
  });
});

describe("noise floor", () => {
  it("histogram median ignores an impulse like the old sort did", () => {
    const v = new Array<number>(200).fill(0.3);
    v[150] = 50;
    const f = robustFloor(v, 100, 1);
    expect(f[160]).toBeCloseTo(1.4826 * 0.3, 1);
  });
});

describe("field-validation harness end to end", () => {
  it("precision and recall on a mixed set of drives", () => {
    const mk = (id: string, o: SimOptions, gt: Array<{ t: number; kind: "pothole" | "speed_bump" | "non_defect" }>) => {
      const tr = simulate(o);
      return {
        traceId: id, vehicleClass: "sedan" as const, mountingPosition: "dashboard_cradle" as const, phoneModel: "sim",
        samples: tr.samples, fixes: tr.fixes,
        groundTruth: gt.map((g) => ({ t: T0 + g.t * 1000, kind: g.kind, lat: latAt(g.t, 35), lng: 85.324 })),
      };
    };
    const report = evaluateValidationDataset([
      mk("a", driving({ speedKph: 35, seed: 3, events: [{ t: 30, kind: "pothole", amp: 11 }, { t: 55, kind: "bump", amp: 8 }] }),
        [{ t: 30, kind: "pothole" }, { t: 55, kind: "speed_bump" }]),
      mk("b", driving({ speedKph: 35, seed: 4, events: [{ t: 25, kind: "kerb", amp: 10 }, { t: 45, kind: "swerve", amp: 8 }] }),
        [{ t: 25, kind: "non_defect" }, { t: 45, kind: "non_defect" }]),
      mk("c", { durationS: 40, mount: "pocket", gait: { hz: 1.9, amp: 2.5 }, gyro: true }, []),
    ]);
    expect(report.falsePositives).toBe(0);
    expect(report.recall).toBe(1);
    expect(report.precision).toBe(1);
  });
});

describe("on-device budget", () => {
  it("is under 2 ms per 100 samples", () => {
    const tr = simulate(driving({ durationS: 120, speedKph: 35, events: [{ t: 60, kind: "pothole", amp: 10 }] }));
    detectImpacts(tr.samples, tr.fixes);
    const t0 = performance.now();
    for (let i = 0; i < 5; i += 1) detectImpacts(tr.samples, tr.fixes);
    const perHundred = ((performance.now() - t0) / 5 / tr.samples.length) * 100;
    console.log("ms per 100 samples (node):", perHundred.toFixed(3));
    expect(perHundred).toBeLessThan(2);
  });
});

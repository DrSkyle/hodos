import { describe, expect, it } from "vitest";
import {
  classifyIRI,
  classifyRoughness,
  estimateIRI,
  estimateRoughnessProxy,
  iriColor,
  roughnessColor,
} from "./iri";
import type { MotionSample } from "./types";

describe("Road Roughness Proxy & IRI Compatibility", () => {
  it("classifies roughness thresholds according to standard bands", () => {
    expect(classifyRoughness(1.8)).toBe("good");
    expect(classifyRoughness(3.2)).toBe("fair");
    expect(classifyRoughness(4.8)).toBe("poor");
    expect(classifyRoughness(6.5)).toBe("severe");
    expect(classifyIRI(1.8)).toBe("good");
  });

  it("maps categories to appropriate cartographic colors", () => {
    expect(roughnessColor("good")).toBe("#2C5530");
    expect(roughnessColor("fair")).toBe("#D97706");
    expect(roughnessColor("poor")).toBe("#DC2626");
    expect(roughnessColor("severe")).toBe("#7F1D1D");
    expect(iriColor("good")).toBe("#2C5530");
  });

  it("handles low speed or insufficient samples gracefully and reports uncalibrated status", () => {
    const samples: MotionSample[] = [{ t: 1000, ax: 0, ay: 0, az: 9.81 }];
    const res = estimateRoughnessProxy(samples, 5.0); // Below 10 km/h
    expect(res.roughnessProxy).toBe(0);
    expect(res.iri).toBe(0);
    expect(res.category).toBe("good");
    expect(res.calibrated).toBe(false);
  });

  it("estimates higher roughness proxy for rough road samples within the 0.5-6 Hz road band", () => {
    // 3 Hz road vibration at 50 Hz sampling (dt = 20 ms)
    const smoothSamples: MotionSample[] = Array.from({ length: 100 }, (_, i) => ({
      t: i * 20,
      ax: 0.05,
      ay: 0.05,
      az: 9.81 + 0.08 * Math.sin((2 * Math.PI * 3.0 * (i * 20)) / 1000),
    }));

    const roughSamples: MotionSample[] = Array.from({ length: 100 }, (_, i) => ({
      t: i * 20,
      ax: 0.2,
      ay: 0.2,
      az: 9.81 + 2.8 * Math.sin((2 * Math.PI * 3.0 * (i * 20)) / 1000),
    }));

    const smoothResult = estimateIRI(smoothSamples, 45.0);
    const roughResult = estimateIRI(roughSamples, 45.0);

    expect(smoothResult.roughnessProxy).toBeLessThan(roughResult.roughnessProxy);
    expect(smoothResult.category).toBe("good");
    expect(["poor", "severe"]).toContain(roughResult.category);
    expect(roughResult.calibrated).toBe(false);
  });

  it("is orientation-independent when the phone is mounted vertically in a dashboard cradle", () => {
    // Same 3 Hz vertical road excitation applied along the Y axis (upright mount, ay = 9.81)
    // vs Z axis (flat mount, az = 9.81).
    const flatMount: MotionSample[] = Array.from({ length: 120 }, (_, i) => {
      const t = i * 20;
      const v = 2.2 * Math.sin((2 * Math.PI * 2.5 * t) / 1000);
      return { t, ax: 0, ay: 0, az: 9.81 + v };
    });

    const cradleMount: MotionSample[] = Array.from({ length: 120 }, (_, i) => {
      const t = i * 20;
      const v = 2.2 * Math.sin((2 * Math.PI * 2.5 * t) / 1000);
      return { t, ax: 0, ay: 9.81 + v, az: 0 };
    });

    const tiltedMount: MotionSample[] = Array.from({ length: 120 }, (_, i) => {
      const t = i * 20;
      const v = 2.2 * Math.sin((2 * Math.PI * 2.5 * t) / 1000);
      const c = Math.SQRT1_2;
      return { t, ax: 0, ay: (9.81 + v) * c, az: (9.81 + v) * c };
    });

    const flatRes = estimateRoughnessProxy(flatMount, 40.0);
    const cradleRes = estimateRoughnessProxy(cradleMount, 40.0);
    const tiltedRes = estimateRoughnessProxy(tiltedMount, 40.0);

    expect(cradleRes.roughnessProxy).toBeCloseTo(flatRes.roughnessProxy, 1);
    expect(tiltedRes.roughnessProxy).toBeCloseTo(flatRes.roughnessProxy, 1);
    expect(cradleRes.category).toBe(flatRes.category);
  });
});

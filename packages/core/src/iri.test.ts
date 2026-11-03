import { describe, expect, it } from "vitest";
import { classifyIRI, estimateIRI, iriColor } from "./iri";
import type { MotionSample } from "./types";

describe("IRI Road Roughness Estimation", () => {
  it("classifies IRI thresholds according to World Bank standards", () => {
    expect(classifyIRI(1.8)).toBe("good");
    expect(classifyIRI(3.2)).toBe("fair");
    expect(classifyIRI(4.8)).toBe("poor");
    expect(classifyIRI(6.5)).toBe("severe");
  });

  it("maps categories to appropriate cartographic colors", () => {
    expect(iriColor("good")).toBe("#2C5530");
    expect(iriColor("fair")).toBe("#D97706");
    expect(iriColor("poor")).toBe("#DC2626");
    expect(iriColor("severe")).toBe("#7F1D1D");
  });

  it("handles low speed or insufficient samples gracefully", () => {
    const samples: MotionSample[] = [{ t: 1000, ax: 0, ay: 0, az: 9.81 }];
    const res = estimateIRI(samples, 5.0); // Below 10 km/h
    expect(res.iri).toBe(0);
    expect(res.category).toBe("good");
  });

  it("estimates higher IRI for high-variance rough road samples", () => {
    const smoothSamples: MotionSample[] = Array.from({ length: 50 }, (_, i) => ({
      t: i * 20,
      ax: 0.1,
      ay: 0.1,
      az: 9.81 + (Math.sin(i) * 0.1),
    }));

    const roughSamples: MotionSample[] = Array.from({ length: 50 }, (_, i) => ({
      t: i * 20,
      ax: 0.5,
      ay: 0.5,
      az: 9.81 + (i % 2 === 0 ? 3.5 : -3.5),
    }));

    const smoothResult = estimateIRI(smoothSamples, 45.0);
    const roughResult = estimateIRI(roughSamples, 45.0);

    expect(smoothResult.iri).toBeLessThan(roughResult.iri);
    expect(smoothResult.category).toBe("good");
    expect(["poor", "severe"]).toContain(roughResult.category);
  });
});

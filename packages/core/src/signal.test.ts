import { describe, expect, it } from "vitest";
import { designBandpass, filter, median, medianInterval, movingRms } from "./signal";

function amplitudeAt(hz: number, sampleRate: number, samples: number): number {
  const coefficients = designBandpass(0.5, 6, sampleRate);
  const signal: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    signal.push(Math.sin((2 * Math.PI * hz * i) / sampleRate));
  }
  const out = filter(signal, coefficients);
  const tail = out.slice(Math.floor(out.length / 2));
  return Math.max(...tail.map((value) => Math.abs(value)));
}

describe("signal", () => {
  it("computes a median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("passes the road-impact band and rejects what sits outside it", () => {
    const sampleRate = 100;
    const inBand = amplitudeAt(2, sampleRate, 2000);
    const fast = amplitudeAt(25, sampleRate, 2000);
    const slow = amplitudeAt(0.02, sampleRate, 20000);
    expect(inBand).toBeGreaterThan(0.6);
    expect(fast).toBeLessThan(inBand * 0.4);
    expect(slow).toBeLessThan(inBand * 0.4);
  });

  it("tracks a rising noise floor", () => {
    const values = [...Array(200).fill(0).map(() => 0.1), ...Array(200).fill(0).map(() => 2)];
    const rms = movingRms(values, 50);
    expect(rms[100]).toBeLessThan(0.2);
    expect(rms[399]).toBeGreaterThan(1.5);
  });

  it("estimates the sampling interval", () => {
    expect(medianInterval([0, 10, 20, 30], 20)).toBe(10);
    expect(medianInterval([7], 20)).toBe(20);
  });
});

import type { Impact } from "./types";

/**
 * On-device repetition ledger. A real defect is felt in the same place on
 * different trips; handling noise and one-off jolts are not. Passes are keyed
 * by a quantised cell (~11 m) and its neighbours, and only a *separate* trip
 * (gap of at least `minSeparationMs`) counts as another pass. Server-side
 * clustering stays the final authority; this just lets the phone say "I have
 * felt this before" without uploading a track.
 */
export interface LedgerOptions {
  /** Cell size in degrees (1e-4 ~ 11 m). */
  cellDeg: number;
  /** Two impacts closer in time than this are the same pass. */
  minSeparationMs: number;
  /** Magnitudes must agree within this ratio to count as the same defect. */
  magnitudeRatio: number;
  /** Confidence added per corroborating earlier pass, capped by `maxBoost`. */
  boostPerPass: number;
  maxBoost: number;
  /** Entries older than this are forgotten. */
  maxAgeMs: number;
}

export const DEFAULT_LEDGER_OPTIONS: LedgerOptions = {
  cellDeg: 1e-4,
  minSeparationMs: 60_000,
  magnitudeRatio: 0.5,
  boostPerPass: 0.08,
  maxBoost: 0.2,
  maxAgeMs: 90 * 86_400_000,
};

interface Entry {
  lat: number;
  lng: number;
  t: number;
  magnitude: number;
  kind: string;
}

export class RepeatLedger {
  private readonly cells = new Map<string, Entry[]>();
  private readonly o: LedgerOptions;

  constructor(options: Partial<LedgerOptions> = {}) {
    this.o = { ...DEFAULT_LEDGER_OPTIONS, ...options };
  }

  private key(ix: number, iy: number): string {
    return ix + ":" + iy;
  }

  /**
   * Record the impact and return it with `repeats` set and confidence raised
   * by earlier corroborating passes. The first sight of a place is unchanged.
   */
  observe(impact: Impact): Impact {
    const ix = Math.floor(impact.lat / this.o.cellDeg);
    const iy = Math.floor(impact.lng / this.o.cellDeg);
    const passTimes: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const entries = this.cells.get(this.key(ix + dx, iy + dy));
        if (entries === undefined) {
          continue;
        }
        for (const e of entries) {
          if (impact.t - e.t > this.o.maxAgeMs || e.kind !== impact.kind) {
            continue;
          }
          const hi = Math.max(e.magnitude, impact.magnitude);
          const lo = Math.min(e.magnitude, impact.magnitude);
          if (hi > 0 && lo / hi < this.o.magnitudeRatio) {
            continue;
          }
          if (Math.abs(impact.t - e.t) >= this.o.minSeparationMs) {
            passTimes.push(e.t);
          }
        }
      }
    }
    // Count distinct earlier passes: entries more than minSeparation apart.
    passTimes.sort((a, b) => a - b);
    let repeats = 0;
    let lastCounted = Number.NEGATIVE_INFINITY;
    for (const pt of passTimes) {
      if (pt - lastCounted >= this.o.minSeparationMs) {
        repeats += 1;
        lastCounted = pt;
      }
    }

    const cellKey = this.key(ix, iy);
    const list = this.cells.get(cellKey) ?? [];
    list.push({ lat: impact.lat, lng: impact.lng, t: impact.t, magnitude: impact.magnitude, kind: impact.kind });
    this.cells.set(cellKey, list);

    if (repeats === 0) {
      return { ...impact, repeats: 0 };
    }
    const boost = Math.min(this.o.maxBoost, this.o.boostPerPass * repeats);
    const confidence = Math.round(Math.min(1, impact.confidence + boost) * 1000) / 1000;
    return { ...impact, confidence, repeats };
  }
}

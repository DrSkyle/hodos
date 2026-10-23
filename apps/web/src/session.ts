import { detectImpacts, haversineMeters, type GeoFix, type Impact, type MotionSample } from "@hodos/core";
import { CONFIG } from "./config";
import { acquireWakeLock, startGeolocation, startMotion } from "./sensors";

export interface SessionSnapshot {
  recording: boolean;
  sampleCount: number;
  fixCount: number;
  impacts: Impact[];
  speedKph: number | null;
  accuracy: number | null;
  travelledM: number;
  lastFix: GeoFix | null;
  error: string | null;
}

/**
 * A foreground recording session. Motion and location are sampled while the
 * screen is on, analysed on-device into impacts, and nothing leaves the phone
 * until the trip ends.
 */
export class CaptureSession {
  private samples: MotionSample[] = [];
  private fixes: GeoFix[] = [];
  private impacts: Impact[] = [];
  private stopMotion?: () => void;
  private stopGeo?: () => void;
  private timer?: number;
  private wakeLock?: WakeLockSentinel;
  private recording = false;
  private error: string | null = null;
  private travelledM = 0;

  constructor(private readonly onUpdate: (snapshot: SessionSnapshot) => void) {}

  async start(): Promise<void> {
    this.samples = [];
    this.fixes = [];
    this.impacts = [];
    this.error = null;
    this.travelledM = 0;
    this.recording = true;
    this.stopMotion = startMotion((sample) => this.samples.push(sample));
    this.stopGeo = startGeolocation(
      (fix) => this.onFix(fix),
      (message) => {
        this.error = message;
        this.emit();
      },
    );
    this.wakeLock = await acquireWakeLock();
    this.timer = window.setInterval(() => this.analyze(), CONFIG.detection.analysisIntervalMs);
    this.emit();
  }

  async stop(): Promise<Impact[]> {
    this.recording = false;
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stopMotion?.();
    this.stopGeo?.();
    this.analyze();
    try {
      await this.wakeLock?.release();
    } catch {
      /* already released */
    }
    this.wakeLock = undefined;
    this.emit();
    return this.impacts;
  }

  private onFix(fix: GeoFix): void {
    const previous = this.fixes[this.fixes.length - 1];
    if (previous !== undefined && fix.accuracy <= 50) {
      const step = haversineMeters(previous, fix);
      if (step < 500) {
        this.travelledM += step;
      }
    }
    this.fixes.push(fix);
  }

  private analyze(): void {
    this.trim();
    const found = detectImpacts(this.samples, this.fixes);
    for (const impact of found) {
      if (!this.impacts.some((existing) => Math.abs(existing.t - impact.t) < 500)) {
        this.impacts.push(impact);
      }
    }
    this.emit();
  }

  private trim(): void {
    const cutoff = Date.now() - CONFIG.detection.windowMs;
    if (this.samples.length > 0) {
      this.samples = this.samples.filter((sample) => sample.t >= cutoff);
    }
    if (this.fixes.length > 0) {
      this.fixes = this.fixes.filter((fix) => fix.t >= cutoff);
    }
  }

  private emit(): void {
    const lastFix = this.fixes[this.fixes.length - 1] ?? null;
    this.onUpdate({
      recording: this.recording,
      sampleCount: this.samples.length,
      fixCount: this.fixes.length,
      impacts: [...this.impacts],
      speedKph: lastFix?.speed != null ? lastFix.speed * 3.6 : null,
      accuracy: lastFix?.accuracy ?? null,
      travelledM: this.travelledM,
      lastFix,
      error: this.error,
    });
  }
}

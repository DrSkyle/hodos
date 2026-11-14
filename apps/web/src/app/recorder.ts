import {
  DEFAULT_DETECT_OPTIONS,
  detectImpacts,
  haversineMeters,
  residuals,
  type GeoFix,
  type Impact,
  type MotionSample
} from "@hodos/core";
import { state, type Observation, type TrailFix } from "./state";
import type { Fix, MotionReading } from "./sensors";

const APPWRITE = "https://sgp.cloud.appwrite.io/v1";
const PROJECT_ID = "6ad7939a002ff135e419";

const SAMPLE_WINDOW_MS = 40_000;
const FIX_WINDOW_MS = 60_000;
const DETECT_EVERY_MS = 4_000;
const ROUGHNESS_WINDOW_MS = 2_000;

/**
 * The recorder is the same engine as the Android app: @hodos/core's adaptive
 * detector, the same speed gate, the same severity grading. The only
 * difference is where the samples come from — DeviceMotion instead of Android
 * sensors — and that a browser page stops sensing when it is backgrounded.
 */

export type LiveStats = {
  recording: boolean;
  startedAt: number | null;
  distanceM: number;
  impacts: number;
  /** Position fixes accepted from the browser. */
  fixes: number;
  /** Motion samples seen since recording started. */
  samples: number;
  speedKph: number;
  accuracyM: number | null;
};

export type RecorderListener = (stats: LiveStats) => void;

type Buffers = {
  samples: MotionSample[];
  fixes: GeoFix[];
  trail: TrailFix[];
};

const buffers: Buffers = { samples: [], fixes: [], trail: [] };

let recording = false;
let startedAt: number | null = null;
let tripId = "";
let distanceM = 0;
let impacts = 0;
let lastImpactAt = Number.NEGATIVE_INFINITY;
let lastDetectAt = 0;
let lastFix: Fix | null = null;
let sampleCount = 0;
let detectTimer: number | null = null;
let stopMotion: (() => void) | null = null;
let stopWatch: (() => void) | null = null;
let listener: RecorderListener | null = null;
let onImpact: (impact: Impact) => void = () => {};

function trim<T extends { t: number }>(items: T[], windowMs: number, now: number) {
  const cutoff = now - windowMs;
  let start = 0;
  while (start < items.length && items[start]!.t < cutoff) start += 1;
  if (start > 0) items.splice(0, start);
}

function stats(): LiveStats {
  const last = buffers.fixes[buffers.fixes.length - 1];
  return {
    recording,
    startedAt,
    distanceM,
    impacts,
    fixes: buffers.fixes.length,
    samples: sampleCount,
    speedKph: last?.speed != null ? last.speed * 3.6 : 0,
    accuracyM: last?.accuracy ?? null
  };
}

function announce() {
  listener?.(stats());
}

/** Sustained vibration energy for the stretch of road around one fix. */
function roughnessAt(t: number): number {
  const from = t - ROUGHNESS_WINDOW_MS;
  const window = buffers.samples.filter((sample) => sample.t >= from && sample.t <= t);
  if (window.length < 8) return 0;
  const series = residuals(window, DEFAULT_DETECT_OPTIONS.gravityAlpha);
  let sum = 0;
  for (const value of series.vertical) sum += value * value;
  return Math.sqrt(sum / series.vertical.length);
}

function sampleToMotion(sample: MotionReading): MotionSample {
  return {
    t: sample.t,
    ax: sample.ax,
    ay: sample.ay,
    az: sample.az,
    gx: sample.gx,
    gy: sample.gy,
    gz: sample.gz,
    interval: sample.interval
  };
}

function onSample(sample: MotionReading) {
  if (!recording) return;
  sampleCount += 1;
  buffers.samples.push(sampleToMotion(sample));
  trim(buffers.samples, SAMPLE_WINDOW_MS, sample.t);
}

function onFix(fix: Fix) {
  if (!recording) return;

  let speed = fix.speed;
  if (speed === null && lastFix) {
    const dt = (fix.t - lastFix.t) / 1000;
    if (dt > 0.5 && dt < 30) {
      const metres = haversineMeters(
        { lat: lastFix.lat, lng: lastFix.lng },
        { lat: fix.lat, lng: fix.lng }
      );
      // A jump larger than a car could make is a bad fix, not speed.
      if (metres / dt < 90) speed = metres / dt;
    }
  }

  if (lastFix && fix.accuracy <= 35) {
    const step = haversineMeters(
      { lat: lastFix.lat, lng: lastFix.lng },
      { lat: fix.lat, lng: fix.lng }
    );
    // Ignore jitter below a metre and teleports that no vehicle could make.
    if (step > 1.2 && step < 400) distanceM += step;
  }

  const geo: GeoFix = {
    t: fix.t,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: Math.min(100, Math.max(0, fix.accuracy)),
    speed
  };
  buffers.fixes.push(geo);
  trim(buffers.fixes, FIX_WINDOW_MS, fix.t);

  if (fix.accuracy <= 35) {
    buffers.trail.push({
      t: fix.t,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speed,
      roughness: roughnessAt(fix.t)
    });
    if (buffers.trail.length > 4000) buffers.trail.splice(0, buffers.trail.length - 4000);
  }

  lastFix = fix;
  announce();
}

/** Runs the shared detector over the rolling window and queues new impacts. */
function detect() {
  if (!recording || buffers.samples.length < 30 || buffers.fixes.length < 2) return;
  const now = Date.now();
  if (now - lastDetectAt < DETECT_EVERY_MS) return;
  lastDetectAt = now;

  let found: Impact[] = [];
  try {
    found = detectImpacts(buffers.samples, buffers.fixes, DEFAULT_DETECT_OPTIONS);
  } catch (_) {
    return;
  }

  for (const impact of found) {
    if (impact.t <= lastImpactAt) continue;
    if (impact.t < startedAt! - 1000) continue;
    lastImpactAt = impact.t;
    impacts += 1;
    enqueueImpact(impact);
    onImpact(impact);
  }
  announce();
}

export function enqueueImpact(impact: Impact) {
  const observation: Observation = {
    deviceId: state.deviceId,
    tripId,
    recordedAt: new Date(impact.t).toISOString(),
    lat: impact.lat,
    lng: impact.lng,
    accuracy: impact.accuracy,
    speedKph: impact.speedKph,
    magnitude: impact.magnitude,
    severity: impact.severity,
    kind: impact.kind,
    confidence: impact.confidence,
    mode: impact.mode,
    observation: "impact"
  };
  state.enqueue(observation);
}

export function start(
  nextListener: RecorderListener,
  onNewImpact: (impact: Impact) => void,
  attach: (handlers: {
    onSample: (sample: MotionReading) => void;
    onFix: (fix: Fix) => void;
    onLocationError: (message: string) => void;
  }) => { stopMotion: () => void; stopWatch: () => void }
) {
  if (recording) return;
  listener = nextListener;
  onImpact = onNewImpact;
  recording = true;
  startedAt = Date.now();
  tripId = `${state.deviceId.slice(0, 8)}-${Date.now().toString(36)}`;
  distanceM = 0;
  impacts = 0;
  sampleCount = 0;
  lastFix = null;
  lastImpactAt = Number.NEGATIVE_INFINITY;
  lastDetectAt = 0;
  buffers.samples.length = 0;
  buffers.fixes.length = 0;
  buffers.trail.length = 0;

  const detach = attach({
    onSample,
    onFix,
    onLocationError: () => announce()
  });
  stopMotion = detach.stopMotion;
  stopWatch = detach.stopWatch;
  detectTimer = window.setInterval(detect, DETECT_EVERY_MS);
  announce();
}

export type FinishedTrip = {
  trip: {
    at: number;
    impacts: number;
    locations: number;
    confirmed: number;
    distanceM: number;
    gpsFixes: number;
    durationS: number;
    tripId: string;
  };
  trail: { at: number; tripId: string; fixes: TrailFix[] };
};

/** Stops sensing and returns the trip that should be stored. */
export function finish(): FinishedTrip | null {
  if (!recording) return null;
  recording = false;
  if (detectTimer !== null) window.clearInterval(detectTimer);
  detectTimer = null;
  stopMotion?.();
  stopWatch?.();
  stopMotion = null;
  stopWatch = null;

  const finishedAt = Date.now();
  const trip: FinishedTrip = {
    trip: {
      at: startedAt ?? finishedAt,
      impacts,
      locations: buffers.fixes.length,
      confirmed: 0,
      distanceM: Math.round(distanceM),
      gpsFixes: buffers.fixes.length,
      durationS: Math.round((finishedAt - (startedAt ?? finishedAt)) / 1000),
      tripId
    },
    trail: {
      at: startedAt ?? finishedAt,
      tripId,
      fixes: buffers.trail.slice()
    }
  };
  announce();
  return trip;
}

export function isRecording(): boolean {
  return recording;
}

export function currentStats(): LiveStats {
  return stats();
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

/**
 * Exactly the wire format the Android app writes: one event row per
 * observation, then a nudge to the aggregation function. The events table
 * accepts anonymous creates; no API key is involved.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const entry of [...state.outbox]) {
    try {
      const response = await fetch(`${APPWRITE}/tablesdb/hodos/tables/events/rows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": PROJECT_ID
        },
        body: JSON.stringify({ rowId: entry.id, data: entry.body })
      });
      if (response.ok || response.status === 409) {
        state.removeOutbox(entry.id);
        sent += 1;
      } else if (response.status >= 400 && response.status < 500) {
        // Permanently rejected: drop it rather than retry forever.
        state.removeOutbox(entry.id);
        failed += 1;
      } else {
        failed += 1;
      }
    } catch (_) {
      failed += 1;
    }
  }

  if (sent > 0) {
    try {
      await fetch(`${APPWRITE}/functions/hodos-aggregate/executions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": PROJECT_ID
        },
        body: JSON.stringify({ async: true })
      });
    } catch (_) {
      // The next flush will ask again.
    }
  }
  return { sent, failed };
}

export type RemoteHazard = {
  id: string;
  lat: number;
  lng: number;
  kind: string;
  severity: number;
  passes: number;
  devices: number;
  fixed: boolean;
  lastSeen?: string;
};

export async function loadHazards(): Promise<RemoteHazard[]> {
  const query = encodeURIComponent(JSON.stringify({ method: "limit", values: [500] }));
  const response = await fetch(`${APPWRITE}/tablesdb/hodos/tables/hazards/rows?queries[]=${query}`, {
    headers: { "X-Appwrite-Project": PROJECT_ID }
  });
  if (!response.ok) throw new Error(`hazards ${response.status}`);
  const body = await response.json();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const out: RemoteHazard[] = [];
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (row.published === false) continue;
    out.push({
      id: String(row.$id ?? row.hazardId ?? ""),
      lat,
      lng,
      kind: ["pothole", "speed_bump", "rough_pavement"].includes(row.kind) ? row.kind : "pothole",
      severity: Math.min(3, Math.max(1, Number(row.severity) || 1)),
      passes: Number(row.passCount ?? row.passes ?? 1) || 1,
      devices: Number(row.deviceCount ?? row.devices ?? 1) || 1,
      fixed: Boolean(row.fixed) || Number(row.fixedVotes) >= 2 || Number(row.clearPasses) >= 3,
      lastSeen: typeof row.lastSeen === "string" ? row.lastSeen : undefined
    });
  }
  return out;
}

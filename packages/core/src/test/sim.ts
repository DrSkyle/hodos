import type { GeoFix, MotionSample } from "../types";

/** Deterministic synthetic sensor traces for the detector tests and the shared parity fixtures. */
export const T0 = 1_700_000_000_000;
const M_PER_DEG = 111_320;

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-9, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type EventKind = "pothole" | "bump" | "rut" | "kerb" | "swerve" | "angled_pothole";
export interface SimEvent {
  /** Seconds from trace start. */
  t: number;
  kind: EventKind;
  /** Peak vertical m/s^2 of the raw pulse. */
  amp: number;
}

export interface SimOptions {
  seed?: number;
  durationS: number;
  rateHz?: number;
  jitter?: boolean;
  mount: "mounted" | "hand" | "pocket";
  gyro?: boolean;
  /** Road noise sigma (m/s^2), in the road band. */
  road?: number;
  /** Engine vibration amplitude (high-frequency). */
  engine?: number;
  /** Constant low-frequency chassis shudder amplitude (diesel bus). */
  shudder?: number;
  gait?: { hz: number; amp: number };
  pedal?: { hz: number; amp: number };
  /** Ground speed in km/h as a function of time (s); null = no fix. */
  speedKph?: number | ((t: number) => number);
  gpsFrom?: number;
  gpsGaps?: Array<[number, number]>;
  events?: SimEvent[];
  /** Random large handling jolts per minute. */
  jolts?: number;
  lat0?: number;
  lng0?: number;
  /** Epoch ms of the first sample (default T0). */
  startMs?: number;
}

export interface SimTrace {
  samples: MotionSample[];
  fixes: GeoFix[];
}

function pulse(kind: EventKind, tau: number, amp: number): { v: number; lat: number; yaw: number } {
  if (tau < 0) return { v: 0, lat: 0, yaw: 0 };
  switch (kind) {
    case "pothole":
      return { v: amp * Math.sin(2 * Math.PI * 8 * tau) * Math.exp(-tau / 0.05), lat: 0.15 * amp * Math.sin(2 * Math.PI * 5 * tau) * Math.exp(-tau / 0.05), yaw: 0 };
    case "angled_pothole":
      return { v: amp * Math.sin(2 * Math.PI * 8 * tau) * Math.exp(-tau / 0.05), lat: 0.7 * amp * Math.sin(2 * Math.PI * 8 * tau) * Math.exp(-tau / 0.05), yaw: 6 };
    case "rut":
      return { v: amp * Math.sin(2 * Math.PI * 7 * tau) * Math.exp(-tau / 0.06), lat: 0.2 * amp * Math.sin(2 * Math.PI * 4 * tau) * Math.exp(-tau / 0.06), yaw: 0 };
    case "bump":
      return tau < 0.3 ? { v: amp * Math.sin((Math.PI * tau) / 0.3), lat: 0.05 * amp, yaw: 0 } : { v: 0, lat: 0, yaw: 0 };
    case "kerb":
      return { v: 0.3 * amp * Math.sin(2 * Math.PI * 7 * tau) * Math.exp(-tau / 0.05), lat: 1.9 * amp * Math.sin(2 * Math.PI * 7 * tau) * Math.exp(-tau / 0.05), yaw: 10 };
    case "swerve":
      return tau < 1.2 ? { v: 0.25 * amp * Math.sin((2 * Math.PI * tau) / 1.2), lat: 1.5 * amp * Math.sin((2 * Math.PI * tau) / 1.2), yaw: 70 * Math.sin((2 * Math.PI * tau) / 1.2) } : { v: 0, lat: 0, yaw: 0 };
  }
}

export function simulate(o: SimOptions): SimTrace {
  const r = rng(o.seed ?? 1);
  const rate = o.rateHz ?? 50;
  const dt = 1 / rate;
  const n = Math.floor(o.durationS * rate);
  const start = o.startMs ?? T0;
  const samples: MotionSample[] = [];
  let road = 0;
  let road2 = 0;
  const phase = r() * 6.28;
  const rn = o.road ?? 0.12;
  let prevRoll = 0;
  let prevPitch = 0;
  const jolts: number[] = [];
  const joltCount = Math.round(((o.jolts ?? 0) * o.durationS) / 60);
  for (let k = 0; k < joltCount; k += 1) jolts.push(2 + r() * (o.durationS - 4));

  for (let k = 0; k < n; k += 1) {
    const jt = o.jitter ? (r() - 0.5) * 6 : 0;
    const t = k * dt;
    // road noise in the 1-4 Hz band: two coupled AR(1) stages
    road = 0.85 * road + rn * 0.5 * gauss(r);
    road2 = 0.8 * road2 + 0.4 * road;
    let v = road2 * 1.6 + 0.03 * gauss(r);
    let lat1 = 0.4 * road2 + 0.02 * gauss(r);
    let lat2 = 0.3 * road2 + 0.02 * gauss(r);
    let yaw = 0;
    if (o.engine) v += o.engine * Math.sin(2 * Math.PI * 17 * t + phase) + 0.3 * o.engine * gauss(r);
    if (o.shudder) {
      const a = o.shudder * (1 + 0.4 * Math.sin(2 * Math.PI * 0.2 * t));
      v += a * Math.sin(2 * Math.PI * 4.3 * t + phase) + 0.15 * a * gauss(r);
      lat1 += 0.5 * a * Math.sin(2 * Math.PI * 3.1 * t);
    }
    if (o.gait) {
      v += o.gait.amp * (Math.sin(2 * Math.PI * o.gait.hz * t) + 0.35 * Math.sin(4 * Math.PI * o.gait.hz * t + 0.6));
      lat1 += 0.5 * o.gait.amp * Math.sin(Math.PI * o.gait.hz * t);
    }
    if (o.pedal) {
      v += o.pedal.amp * Math.sin(2 * Math.PI * o.pedal.hz * t);
      lat1 += 0.8 * o.pedal.amp * Math.sin(2 * Math.PI * o.pedal.hz * t + 1);
    }
    for (const e of o.events ?? []) {
      const p = pulse(e.kind, t - e.t, e.amp);
      v += p.v;
      lat1 += p.lat;
      yaw += p.yaw;
    }
    for (const jtm of jolts) {
      const tau = t - jtm;
      if (tau >= 0 && tau < 0.4) {
        v += 9 * Math.sin(2 * Math.PI * 6 * tau) * Math.exp(-tau / 0.1);
        lat1 += 6 * Math.sin(2 * Math.PI * 5 * tau) * Math.exp(-tau / 0.1);
      }
    }

    let roll = 0.02 * Math.sin(0.4 * t + phase);
    let pitch = 0.015 * Math.sin(0.3 * t);
    if (o.mount === "hand") {
      roll = 0.6 * Math.sin(2 * Math.PI * 0.35 * t + phase) + 0.25 * Math.sin(2 * Math.PI * 0.9 * t);
      pitch = 0.5 * Math.sin(2 * Math.PI * 0.27 * t + 1) + 0.2 * Math.sin(2 * Math.PI * 0.7 * t);
    } else if (o.mount === "pocket") {
      roll = 0.5 * Math.sin(2 * Math.PI * 0.95 * t + phase);
      pitch = 0.35 * Math.sin(2 * Math.PI * 0.95 * t);
    }
    const dirx = Math.sin(roll);
    const diry = Math.sin(pitch);
    const dirz = Math.sqrt(Math.max(0.01, 1 - dirx * dirx - diry * diry));
    // perpendicular basis
    const p1x = dirz;
    const p1y = 0;
    const p1z = -dirx;
    const n1 = Math.sqrt(p1x * p1x + p1z * p1z) || 1;
    const p2x = diry * dirz * 0 + (diry * -dirx) ;
    const p2y = dirz * dirz + dirx * dirx;
    const p2z = -diry * dirz;
    const n2 = Math.sqrt(p2x * p2x + p2y * p2y + p2z * p2z) || 1;
    const G = 9.81;
    const ax = G * dirx + v * dirx + (lat1 * p1x) / n1 + (lat2 * p2x) / n2;
    const ay = G * diry + v * diry + (lat1 * p1y) / n1 + (lat2 * p2y) / n2;
    const az = G * dirz + v * dirz + (lat1 * p1z) / n1 + (lat2 * p2z) / n2;
    const s: MotionSample = { t: Math.round(start + t * 1000 + jt), ax, ay, az };
    if (o.gyro) {
      const gxd = ((roll - prevRoll) / dt) * (180 / Math.PI);
      const gyd = ((pitch - prevPitch) / dt) * (180 / Math.PI);
      s.gx = gxd + 1.2 * gauss(r);
      s.gy = gyd + 1.2 * gauss(r);
      s.gz = yaw + 1.2 * gauss(r) * dirz + 0;
    }
    prevRoll = roll;
    prevPitch = pitch;
    samples.push(s);
  }

  const fixes: GeoFix[] = [];
  const sp = o.speedKph;
  if (sp !== undefined) {
    let lat = o.lat0 ?? 27.7172;
    const lng = o.lng0 ?? 85.324;
    let last = o.gpsFrom ?? 0;
    for (let s = o.gpsFrom ?? 0; s <= o.durationS; s += 1) {
      const kph = typeof sp === "number" ? sp : sp(s);
      const mps = kph / 3.6;
      lat += (mps * (s - last)) / M_PER_DEG;
      last = s;
      if ((o.gpsGaps ?? []).some(([a, b]) => s >= a && s <= b)) continue;
      fixes.push({ t: start + s * 1000, lat, lng, accuracy: 5, speed: mps });
    }
  }
  return { samples, fixes };
}

/** Where a vehicle at constant `kph` is `seconds` after start, for ground-truth coordinates. */
export function latAt(seconds: number, kph: number, lat0 = 27.7172): number {
  return lat0 + (kph / 3.6) * seconds / M_PER_DEG;
}

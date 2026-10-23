export type HazardKind = "pothole" | "speed_bump" | "rough_pavement";

export type Severity = 1 | 2 | 3;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MotionSample {
  /** Epoch milliseconds. */
  t: number;
  /** Acceleration including gravity on the device x axis, m/s^2. */
  ax: number;
  /** Acceleration including gravity on the device y axis, m/s^2. */
  ay: number;
  /** Acceleration including gravity on the device z axis, m/s^2. */
  az: number;
  /** Nominal sampling interval in milliseconds, when the platform reports one. */
  interval?: number;
}

export interface GeoFix {
  /** Epoch milliseconds. */
  t: number;
  lat: number;
  lng: number;
  /** Horizontal accuracy in metres. */
  accuracy: number;
  /** Ground speed in metres per second, null when the platform cannot provide it. */
  speed: number | null;
}

export interface Impact {
  /** Epoch milliseconds of the peak. */
  t: number;
  lat: number;
  lng: number;
  /** Horizontal accuracy of the position attached to the impact, in metres. */
  accuracy: number;
  /** Ground speed at the impact, km/h. */
  speedKph: number;
  /** Peak vertical acceleration above gravity, m/s^2. */
  magnitude: number;
  severity: Severity;
  kind: HazardKind;
}

export interface ObservedImpact extends Impact {
  /** Anonymous, rotating identifier of the Device that observed the impact. */
  deviceId: string;
}

export interface Hazard {
  id: string;
  lat: number;
  lng: number;
  kind: HazardKind;
  severity: Severity;
  /** Number of impacts that corroborate this hazard. */
  passCount: number;
  /** Number of distinct Devices that corroborate this hazard. */
  deviceCount: number;
  /** Belief that the hazard exists, 0..1. */
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  /** Whether the hazard has enough corroboration to appear on the public map. */
  published: boolean;
}

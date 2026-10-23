export type HazardKind = "pothole" | "speed_bump" | "rough_pavement";

export type Severity = 1 | 2 | 3;

export type TravelMode = "vehicle" | "pedestrian";

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
  /** Rotation rate about the device axes, degrees/second, when available. */
  gx?: number;
  gy?: number;
  gz?: number;
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

export interface ImpactFeatures {
  /** Peak vertical acceleration above gravity, m/s^2. */
  peak: number;
  /** Time from half-peak, before the peak, to the peak. */
  riseMs: number;
  /** Time spent above half-peak. */
  widthMs: number;
  /** Distinct lobes above the half-peak level. */
  lobes: number;
  /** Maximum rate of change of vertical acceleration, m/s^3. */
  jerk: number;
  /** Lateral acceleration at the event, as a fraction of the peak. */
  lateralRatio: number;
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
  /** Magnitude with the effect of speed divided out, m/s^2. */
  normalised: number;
  /** Severity, graded on the speed-normalised magnitude. */
  severity: Severity;
  kind: HazardKind;
  /** Belief that this is a real defect, 0..1. */
  confidence: number;
  /** How the device was moving. */
  mode: TravelMode;
  features: ImpactFeatures;
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
  /** Number of distinct calendar days on which it has been observed. */
  dayCount: number;
  /** Belief that the hazard exists, 0..1. */
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  /** Whether the hazard has enough corroboration to appear on the public map. */
  published: boolean;
  /** How many people have reported this hazard fixed. */
  fixedVotes: number;
  /** Passes in which a Device travelled this hazard and felt nothing. */
  clearPasses: number;
}

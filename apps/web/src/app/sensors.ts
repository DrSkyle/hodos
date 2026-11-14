/**
 * Device capabilities, asked for in the open.
 *
 * Each permission is described in plain words before it is requested, and the
 * UI never pretends one was granted when the browser refused it. Two honest
 * limits are surfaced rather than hidden: a web page cannot keep sensing once
 * the tab is backgrounded or the screen locks, and iOS requires a tap before
 * motion events are available at all.
 */

export type PermissionName = "location" | "motion" | "notifications" | "wakeLock";

export type PermissionState = "unknown" | "granted" | "denied" | "unsupported";

export const PERMISSION_COPY: Record<PermissionName, { title: string; detail: string; required: boolean }> = {
  location: {
    title: "Location",
    detail: "Ties each bump to a road position and measures distance. Precise history never leaves the device.",
    required: true
  },
  motion: {
    title: "Motion sensors",
    detail: "Reads the accelerometer and gyroscope so Hodos can feel the road. Requires a tap on iPhone and iPad.",
    required: true
  },
  notifications: {
    title: "Notifications",
    detail: "Shows a quiet reminder while a drive is recording. Nothing else is ever sent.",
    required: false
  },
  wakeLock: {
    title: "Keep the screen awake",
    detail: "Stops the phone sleeping mid-drive, which would pause the sensors.",
    required: false
  }
};

const states: Record<PermissionName, PermissionState> = {
  location: "unknown",
  motion: "unknown",
  notifications: "unknown",
  wakeLock: "unknown"
};

export function permissionState(name: PermissionName): PermissionState {
  return states[name];
}

export function setPermissionState(name: PermissionName, value: PermissionState) {
  states[name] = value;
}

export function motionSupported(): boolean {
  return typeof DeviceMotionEvent !== "undefined";
}

function needsMotionPrompt(): boolean {
  const ctor = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  return typeof ctor?.requestPermission === "function";
}

export async function requestLocation(): Promise<PermissionState> {
  if (!("geolocation" in navigator)) {
    states.location = "unsupported";
    return "unsupported";
  }
  const result = await new Promise<PermissionState>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "unknown"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
  states.location = result;
  return result;
}

export async function requestMotion(): Promise<PermissionState> {
  if (!motionSupported()) {
    states.motion = "unsupported";
    return "unsupported";
  }
  if (!needsMotionPrompt()) {
    states.motion = "granted";
    return "granted";
  }
  try {
    const ctor = DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> };
    const answer = await ctor.requestPermission();
    states.motion = answer === "granted" ? "granted" : "denied";
  } catch (_) {
    // iOS only answers inside a real user gesture; treat a throw as denied.
    states.motion = "denied";
  }
  return states.motion;
}

export async function requestNotifications(): Promise<PermissionState> {
  if (!("Notification" in window)) {
    states.notifications = "unsupported";
    return "unsupported";
  }
  try {
    const answer = await Notification.requestPermission();
    states.notifications = answer === "granted" ? "granted" : answer === "denied" ? "denied" : "unknown";
  } catch (_) {
    states.notifications = "denied";
  }
  return states.notifications;
}

let lock: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<PermissionState> {
  const api = navigator as unknown as { wakeLock?: { request: (type: string) => Promise<WakeLockSentinel> } };
  if (!api.wakeLock) {
    states.wakeLock = "unsupported";
    return "unsupported";
  }
  try {
    lock = await api.wakeLock.request("screen");
    states.wakeLock = "granted";
    lock.addEventListener("release", () => {
      lock = null;
      if (states.wakeLock === "granted") states.wakeLock = "unknown";
    });
  } catch (_) {
    states.wakeLock = "denied";
  }
  return states.wakeLock;
}

export async function releaseWakeLock() {
  try {
    await lock?.release();
  } catch (_) {
    // The screen may already be off; nothing to release.
  }
  lock = null;
}

/** Re-take the lock when the tab returns, which browsers require. */
export function keepAwakeOnReturn() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && states.wakeLock === "granted" && !lock) {
      void requestWakeLock();
    }
  });
}

export type Fix = {
  t: number;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
};

export function watchPosition(onFix: (fix: Fix) => void, onError: (message: string) => void): () => void {
  if (!("geolocation" in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(
    (position) => {
      const c = position.coords;
      onFix({
        t: position.timestamp || Date.now(),
        lat: c.latitude,
        lng: c.longitude,
        accuracy: Number.isFinite(c.accuracy) ? c.accuracy : 100,
        speed: typeof c.speed === "number" && Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null
      });
    },
    (error) => onError(error.message || "Location unavailable"),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

export type MotionReading = { t: number; ax: number; ay: number; az: number; gx?: number; gy?: number; gz?: number; interval?: number };

export function listenMotion(onSample: (sample: MotionReading) => void): () => void {
  if (!motionSupported()) return () => {};
  const handler = (event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const r = event.rotationRate;
    const interval = event.interval && event.interval > 0 ? event.interval * 1000 : undefined;
    onSample({
      t: Date.now(),
      ax: a.x,
      ay: a.y,
      az: a.z,
      gx: r?.alpha ?? undefined,
      gy: r?.beta ?? undefined,
      gz: r?.gamma ?? undefined,
      interval
    });
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}

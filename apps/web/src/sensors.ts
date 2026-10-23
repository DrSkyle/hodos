import type { GeoFix, MotionSample } from "@hodos/core";

interface MotionPermissionCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export function motionSupported(): boolean {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window;
}

/**
 * Request motion access. iOS requires an explicit, user-gesture-initiated
 * grant; every other platform is policy-gated and needs no prompt.
 */
export async function requestMotionAccess(): Promise<boolean> {
  if (!motionSupported()) {
    return false;
  }
  const ctor = (window as unknown as { DeviceMotionEvent: MotionPermissionCtor }).DeviceMotionEvent;
  if (typeof ctor.requestPermission === "function") {
    try {
      return (await ctor.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export function startMotion(onSample: (sample: MotionSample) => void): () => void {
  const handler = (event: DeviceMotionEvent): void => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) {
      return;
    }
    onSample({
      t: Date.now(),
      ax: a.x,
      ay: a.y,
      az: a.z,
      interval: event.interval && event.interval > 0 ? event.interval : undefined,
    });
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}

export function startGeolocation(
  onFix: (fix: GeoFix) => void,
  onError?: (message: string) => void,
): () => void {
  if (!("geolocation" in navigator)) {
    onError?.("Location is unavailable on this device.");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (position) => {
      onFix({
        t: position.timestamp || Date.now(),
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
      });
    },
    (error) => onError?.(error.message),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Keep the screen alive while recording, where the platform allows it. */
export async function acquireWakeLock(): Promise<WakeLockSentinel | undefined> {
  try {
    if ("wakeLock" in navigator) {
      return await navigator.wakeLock.request("screen");
    }
  } catch {
    /* wake lock is best-effort */
  }
  return undefined;
}

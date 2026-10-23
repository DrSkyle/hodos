const DEVICE_KEY = "hodos.device.v1";
const ROTATION_MS = 24 * 60 * 60 * 1000;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * A rotating, anonymous Device identifier. It never leaves the phone as an
 * identity: it exists only to distinguish corroborating observations, and it
 * rotates every 24 hours.
 */
export function deviceId(): string {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; t: number };
      if (typeof parsed.id === "string" && now - parsed.t < ROTATION_MS) {
        return parsed.id;
      }
    }
  } catch {
    /* storage unavailable: fall through to an ephemeral id */
  }
  const id = randomId();
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ id, t: now }));
  } catch {
    /* ignore */
  }
  return id;
}

export function newTripId(): string {
  return randomId();
}

/** Stable, Appwrite-safe row id for a hazard at a rounded coordinate. */
export function rowIdFor(lat: number, lng: number): string {
  const ns = lat < 0 ? "s" : "n";
  const ew = lng < 0 ? "w" : "e";
  return `${ns}${Math.abs(lat).toFixed(4)}${ew}${Math.abs(lng).toFixed(4)}`;
}

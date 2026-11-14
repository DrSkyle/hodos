/**
 * Everything the web app remembers, and nothing it does not.
 *
 * Trips, trails, saved roads and the outbox live in this browser's local
 * storage. There is no account and no server-side profile. The installation id
 * is a random value created here, not derived from a person or a device.
 */

export type Trip = {
  at: number;
  impacts: number;
  locations: number;
  confirmed: number;
  distanceM: number;
  gpsFixes?: number;
  durationS?: number;
  tripId?: string;
};

export type TrailFix = {
  t: number;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  roughness: number;
};

export type Trail = {
  at: number;
  tripId: string;
  fixes: TrailFix[];
};

export type Observation = {
  deviceId: string;
  tripId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  accuracy: number;
  speedKph: number;
  magnitude: number;
  severity: number;
  kind: string;
  confidence: number;
  mode: string;
  observation: "impact" | "pass" | "fix";
  hazardRef?: string;
};

export type Profile = "mixed" | "car" | "scooter" | "bike";

type Store = {
  deviceId: string;
  trips: Trip[];
  trails: Trail[];
  savedRoads: string[];
  profile: Profile;
  outbox: { id: string; body: Observation }[];
  armed: boolean;
};

const KEY = "hodos.web.v1";
const MAX_TRIPS = 50;
const MAX_TRAILS = 20;
const MAX_OUTBOX = 400;

function freshDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyStore(): Store {
  return {
    deviceId: freshDeviceId(),
    trips: [],
    trails: [],
    savedRoads: [],
    profile: "mixed",
    outbox: [],
    armed: false
  };
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const base = emptyStore();
    return {
      deviceId: typeof parsed.deviceId === "string" && parsed.deviceId ? parsed.deviceId : base.deviceId,
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
      trails: Array.isArray(parsed.trails) ? parsed.trails : [],
      savedRoads: Array.isArray(parsed.savedRoads) ? parsed.savedRoads : [],
      profile: parsed.profile === "car" || parsed.profile === "scooter" || parsed.profile === "bike" ? parsed.profile : "mixed",
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
      armed: parsed.armed === true
    };
  } catch (_) {
    return emptyStore();
  }
}

let store: Store | null = null;

function current(): Store {
  if (!store) store = read();
  return store;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current()));
  } catch (_) {
    // A full quota must never break recording; the in-memory copy still works.
  }
}

export const state = {
  get deviceId(): string {
    return current().deviceId;
  },
  get trips(): Trip[] {
    return current().trips;
  },
  get trails(): Trail[] {
    return current().trails;
  },
  get savedRoads(): string[] {
    return current().savedRoads;
  },
  get profile(): Profile {
    return current().profile;
  },
  get armed(): boolean {
    return current().armed;
  },
  get outbox(): { id: string; body: Observation }[] {
    return current().outbox;
  },

  setArmed(armed: boolean) {
    current().armed = armed;
    persist();
  },

  setProfile(profile: Profile) {
    current().profile = profile;
    persist();
  },

  addTrip(trip: Trip, trail: Trail | null) {
    const s = current();
    s.trips = [trip, ...s.trips].slice(0, MAX_TRIPS);
    if (trail && trail.fixes.length > 0) {
      s.trails = [trail, ...s.trails].slice(0, MAX_TRAILS);
    }
    persist();
  },

  toggleSavedRoad(id: string): boolean {
    const s = current();
    const has = s.savedRoads.includes(id);
    s.savedRoads = has ? s.savedRoads.filter((item) => item !== id) : [id, ...s.savedRoads].slice(0, 100);
    persist();
    return !has;
  },

  enqueue(body: Observation) {
    const s = current();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    s.outbox = [...s.outbox, { id, body }].slice(-MAX_OUTBOX);
    persist();
    return id;
  },

  removeOutbox(id: string) {
    const s = current();
    s.outbox = s.outbox.filter((item) => item.id !== id);
    persist();
  },

  clearHistory() {
    const s = current();
    s.trips = [];
    s.trails = [];
    s.savedRoads = [];
    persist();
  },

  totalDistanceM(): number {
    return current().trips.reduce((sum, trip) => sum + (Number(trip.distanceM) || 0), 0);
  }
};

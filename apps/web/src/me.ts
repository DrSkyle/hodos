import { haversineMeters, type GeoFix } from "@hodos/core";

export interface TripRecord {
  at: number;
  impacts: number;
  locations: number;
  confirmed: number;
  distanceM: number;
}

export interface Me {
  area: string | null;
  centre: { lat: number; lng: number } | null;
  trips: TripRecord[];
}

const KEY = "hodos.me.v1";
const EMPTY: Me = { area: null, centre: null, trips: [] };

export function loadMe(): Me {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      return { ...EMPTY, trips: [] };
    }
    const parsed = JSON.parse(raw) as Partial<Me>;
    return {
      area: parsed.area ?? null,
      centre: parsed.centre ?? null,
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    };
  } catch {
    return { ...EMPTY, trips: [] };
  }
}

export function saveMe(me: Me): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(me));
  } catch {
    /* storage unavailable */
  }
}

export function distanceOf(fixes: GeoFix[]): number {
  const ordered = [...fixes].sort((a, b) => a.t - b.t);
  let total = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (previous !== undefined && current !== undefined) {
      total += haversineMeters(previous, current);
    }
  }
  return total;
}

export interface Tally {
  trips: number;
  impacts: number;
  locations: number;
  confirmed: number;
  distanceM: number;
  lastTripAt: number | null;
}

export function tally(me: Me): Tally {
  return me.trips.reduce<Tally>(
    (acc, trip) => ({
      trips: acc.trips + 1,
      impacts: acc.impacts + trip.impacts,
      locations: acc.locations + trip.locations,
      confirmed: acc.confirmed + trip.confirmed,
      distanceM: acc.distanceM + trip.distanceM,
      lastTripAt: acc.lastTripAt === null ? trip.at : Math.max(acc.lastTripAt, trip.at),
    }),
    { trips: 0, impacts: 0, locations: 0, confirmed: 0, distanceM: 0, lastTripAt: null },
  );
}

export function formatDistance(metres: number): string {
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }
  return `${(metres / 1000).toFixed(1)} km`;
}

export function relativeTime(at: number | null): string {
  if (at === null) {
    return "never";
  }
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function spanDays(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

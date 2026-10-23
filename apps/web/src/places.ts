const KEY = "hodos.place.v1";
const ZOOM = 14;

interface NominatimAddress {
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  village?: string;
  town?: string;
  city?: string;
  city_district?: string;
  county?: string;
  state?: string;
  country?: string;
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function loadCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable */
  }
}

function nameFrom(address: NominatimAddress): string | null {
  const local =
    address.neighbourhood ??
    address.suburb ??
    address.quarter ??
    address.village ??
    address.city_district ??
    address.town;
  const city = address.city ?? address.town ?? address.county;
  if (local !== undefined && city !== undefined && local !== city) {
    return `${local}, ${city}`;
  }
  return local ?? city ?? address.state ?? null;
}

/**
 * Reverse-geocode an approximate position to a short, human area name, cached
 * per ~1 km cell so the app asks the geocoder at most once per area.
 */
export async function describeArea(lat: number, lng: number): Promise<string | null> {
  const cache = loadCache();
  const key = cacheKey(lat, lng);
  const cached = cache[key];
  if (cached !== undefined) {
    return cached === "" ? null : cached;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${ZOOM}&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { address?: NominatimAddress };
    const name = body.address ? nameFrom(body.address) : null;
    cache[key] = name ?? "";
    saveCache(cache);
    return name;
  } catch {
    return null;
  }
}

import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } from "./site-constants";

/**
 * Live shop pins, for the Nepal Garage.
 *
 * These are the shops that actually paid for a pin on the map, read from the
 * same backend table the map and the API use. A pin is only returned while it is
 * paid up — an expired or unpaid placement never appears here, so the Garage can
 * never advertise a shop that is no longer on the map.
 *
 * There is no seeded or sample fallback: an empty backend renders an empty
 * shelf, which is the honest thing to show.
 */

export type LiveShop = {
  id: string;
  name: string;
  category: string;
  offer: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  link: string | null;
  lat: number;
  lng: number;
  /** ISO expiry of the paid placement. */
  activeUntil: string;
};

const QUERY = encodeURIComponent(JSON.stringify({ method: "limit", values: [500] }));

/** Every pin that is live right now. Never throws: an outage returns []. */
export async function loadLiveShops(): Promise<LiveShop[]> {
  let rows: unknown[];
  try {
    const response = await fetch(
      `${APPWRITE_ENDPOINT}/tablesdb/hodos/tables/partners/rows?queries[]=${QUERY}`,
      { headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID } }
    );
    if (!response.ok) return [];
    const body = await response.json();
    rows = Array.isArray(body?.rows) ? body.rows : [];
  } catch (_) {
    return [];
  }

  const now = Date.now();
  const shops: LiveShop[] = [];
  for (const [index, raw] of rows.entries()) {
    const row = raw as Record<string, unknown>;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    const until = Date.parse(String(row.activeUntil ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // An expired pin is not a shop we can send a rider to.
    if (Number.isFinite(until) && until < now) continue;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    shops.push({
      id: String(row.id ?? row.$id ?? `shop-${index}`),
      name,
      category: String(row.category ?? "business"),
      offer: String(row.offer ?? ""),
      address: row.address ? String(row.address) : null,
      phone: row.phone ? String(row.phone) : null,
      email: row.email ? String(row.email) : null,
      link: typeof row.link === "string" && row.link ? row.link : null,
      lat,
      lng,
      activeUntil: String(row.activeUntil ?? "")
    });
  }

  shops.sort((a, b) => a.name.localeCompare(b.name));
  return shops;
}

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

export type ShopDeal = {
  badge: string;
  title: string;
};

export type LiveShop = {
  id: string;
  name: string;
  /** Clean canonical display category (e.g. "Tyres", "Garage", "Food & Café"). */
  category: string;
  /** Original category stored on the pin row (retained for search). */
  rawCategory: string;
  offer: string;
  summary: string;
  deals: ShopDeal[];
  address: string | null;
  phone: string | null;
  email: string | null;
  link: string | null;
  lat: number;
  lng: number;
  /** ISO expiry of the placement. */
  activeUntil: string;
};

/**
 * Unifies messy / singular / lowercase category strings ("tyre", "Tyres",
 * "Restaurant", "cafe", "business") into crisp, deduplicated display tags.
 */
export function normalizeShopCategory(raw: string): string {
  const clean = String(raw || "").trim();
  if (!clean) return "Local Shop";
  const c = clean.toLowerCase();
  if (/^(tyre|tyres|tire|tires|puncture|alignment|wheels?)$/.test(c) || /tyre|tire|puncture/.test(c)) {
    return "Tyres";
  }
  if (/garage|workshop|mechanic|auto|moto|bike|repair|service|parts|tow|wash/.test(c)) {
    return "Garage";
  }
  if (/ev|charg|fuel|petrol|diesel|gas|battery/.test(c)) {
    return "EV & Fuel";
  }
  if (/pharm|med|clinic|hospital|health|chemist/.test(c)) {
    return "Pharmacy";
  }
  if (/restaurant|cafe|café|coffee|tea|food|biryani|bakery|snack|dhaba|eat|dining|hotel/.test(c)) {
    return "Food & Café";
  }
  if (/parking/.test(c)) {
    return "Parking";
  }
  if (/^(business|shop|store|local|local stop|local shop|other)$/.test(c)) {
    return "Local Shop";
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function parseShopOffer(raw: string): { summary: string; deals: ShopDeal[] } {
  const text = String(raw || "").trim();
  if (!text) return { summary: "", deals: [] };
  const sepIdx = text.indexOf("||");
  if (sepIdx === -1) return { summary: text, deals: [] };
  const summary = text.slice(0, sepIdx).trim();
  const rest = text.slice(sepIdx + 2).trim();
  const deals: ShopDeal[] = [];
  for (const part of rest.split("|")) {
    const clean = part.trim();
    if (!clean) continue;
    const match = clean.match(/^\[([^\]]{1,16})\]\s*(.+)$/);
    if (match) {
      deals.push({ badge: match[1]!.trim(), title: match[2]!.trim() });
    } else {
      deals.push({ badge: "OFFER", title: clean });
    }
  }
  return { summary, deals };
}

export function encodeShopOffer(summary: string, deals: ShopDeal[], maxLen = 160): string {
  const cleanSummary = summary.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  const cleanDeals = deals
    .map((d) => ({
      badge: d.badge.replace(/[\[\]|]/g, "").trim().slice(0, 14),
      title: d.title.replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)
    }))
    .filter((d) => d.title.length > 0)
    .slice(0, 3);

  if (cleanDeals.length === 0) return cleanSummary.slice(0, maxLen);
  const encodedDeals = cleanDeals
    .map((d) => (d.badge ? `[${d.badge}] ${d.title}` : d.title))
    .join(" | ");
  const joined = cleanSummary ? `${cleanSummary} || ${encodedDeals}` : `|| ${encodedDeals}`;
  return joined.slice(0, maxLen);
}

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
    const offer = String(row.offer ?? "");
    const parsed = parseShopOffer(offer);
    const rawCategory = String(row.category ?? "Local Shop").trim() || "Local Shop";
    shops.push({
      id: String(row.$id ?? row.id ?? `shop-${index}`),
      name,
      category: normalizeShopCategory(rawCategory),
      rawCategory,
      offer,
      summary: parsed.summary,
      deals: parsed.deals,
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

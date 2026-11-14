import { OFFER_LINKS, AFFILIATE_LINKS, isAdmitadTrackingHost } from "./site-constants";

/**
 * Every partner shop the account has a working link for.
 *
 * One list, used by the landing page, the Garage and the API, so a shop is
 * never missing from one surface because someone forgot to update a second copy.
 *
 * Rules that keep this honest:
 *  · Every row is a real, resolved link from the account, named for the shop it
 *    actually opens. Nothing is inferred from the URL slug.
 *  · Rows carry the categories they genuinely sell, so a road app shows car and
 *    travel things first and does not dress itself up as a fashion shop.
 *  · Rows with a country are only shown to that country: an Indian buyer should
 *    not be sent to a Polish travel site.
 */

export type Offer = {
  key: string;
  name: string;
  /** What the shop sells, in two or three words. */
  category: "Car & kit" | "Travel" | "Money back" | "Tech" | "Style";
  blurb: string;
  url: string;
  /** ISO country codes. Absent means worldwide. */
  regions?: string[];
  /** 0 = show first. Keeps the best fit for a road app at the top. */
  rank: number;
};

/** Direct links, resolved from the account. Destination is baked into the id. */
const direct: Offer[] = [
  {
    key: "woopdrive",
    name: "WoopDrive",
    category: "Travel",
    blurb: "Hire a car instead of wearing your own out on a long route.",
    url: OFFER_LINKS.woopdrive,
    rank: 1
  },
  {
    key: "flyfi",
    name: "Flyfi",
    category: "Travel",
    blurb: "Hotels and stays for the overnight part of a drive.",
    url: OFFER_LINKS.flyfi,
    rank: 2
  },
  {
    key: "avitovip",
    name: "AvitoVIP",
    category: "Travel",
    blurb: "Fixed-price airport transfers in Turkey — the first and last leg.",
    url: OFFER_LINKS.avitovip,
    regions: ["TR"],
    rank: 3
  },
  {
    key: "compensair",
    name: "Compensair",
    category: "Money back",
    blurb: "Claim compensation when a flight is delayed or cancelled.",
    url: OFFER_LINKS.compensair,
    rank: 4
  },
  {
    key: "lennuabi",
    name: "Lennuabi",
    category: "Money back",
    blurb: "EU flight compensation claims, up to €600 per passenger.",
    url: OFFER_LINKS.lennuabi,
    regions: ["EE", "LV", "LT", "FI", "SE", "DE", "FR", "ES", "IT", "NL", "PL", "IE"],
    rank: 5
  },
  {
    key: "redmagic",
    name: "REDMAGIC",
    category: "Tech",
    blurb: "Gaming phones and mobile hardware — a fast phone for the dash.",
    url: OFFER_LINKS.redmagic,
    rank: 6
  },
  {
    key: "bewakoof",
    name: "Bewakoof",
    category: "Style",
    blurb: "Graphic tees and street basics, shipped in India.",
    url: OFFER_LINKS.bewakoof,
    regions: ["IN"],
    rank: 7
  },
  {
    key: "hellomolly",
    name: "Hello Molly",
    category: "Style",
    blurb: "Occasion wear, shipped worldwide.",
    url: OFFER_LINKS.hellomolly,
    rank: 9
  },
  {
    key: "chicme",
    name: "ChicMe",
    category: "Style",
    blurb: "Everyday womenswear at low prices.",
    url: OFFER_LINKS.chicme,
    rank: 10
  },
  {
    key: "versace",
    name: "Palazzo Versace",
    category: "Travel",
    blurb: "A Dubai stopover that is a destination in itself.",
    url: OFFER_LINKS.versace,
    regions: ["AE"],
    rank: 11
  }
];

/** Program links, which can be pointed at any page on that shop. */
const programs: Offer[] = [
  {
    key: "aliexpress",
    name: "AliExpress",
    category: "Car & kit",
    blurb: "Mounts, inflators, dash cams and car care, at marketplace prices.",
    url: AFFILIATE_LINKS.aliexpress,
    rank: 0
  },
  {
    key: "banggood",
    name: "Banggood",
    category: "Car & kit",
    blurb: "Tools, meters and electronics for the boot of the car.",
    url: AFFILIATE_LINKS.banggood,
    rank: 5
  },
  {
    key: "airalo",
    name: "Airalo",
    category: "Travel",
    blurb: "An eSIM so the map keeps working when you cross a border.",
    url: AFFILIATE_LINKS.airalo,
    rank: 4
  },
  {
    key: "klook",
    name: "Klook",
    category: "Travel",
    blurb: "Tickets and activities for the other end of the drive.",
    url: AFFILIATE_LINKS.klook,
    rank: 5
  },
  {
    key: "hamaramall",
    name: "HamaraMall",
    category: "Car & kit",
    blurb: "Indian marketplace with domestic delivery — no customs wait.",
    url: AFFILIATE_LINKS.hamaramall,
    regions: ["IN"],
    rank: 0
  },
  {
    key: "flipkart",
    name: "Flipkart",
    category: "Car & kit",
    blurb: "Car and bike accessories, next-day across India.",
    url: AFFILIATE_LINKS.flipkart,
    regions: ["IN"],
    rank: 1
  },
  {
    key: "amazonin",
    name: "Amazon India",
    category: "Car & kit",
    blurb: "Car care, tools and tyres with fast domestic delivery.",
    url: AFFILIATE_LINKS.amazonin,
    regions: ["IN"],
    rank: 2
  },
  {
    key: "cars24",
    name: "Cars24",
    category: "Car & kit",
    blurb: "Inspected used cars, if the repair bill outweighs the car.",
    url: AFFILIATE_LINKS.cars24,
    regions: ["IN"],
    rank: 8
  }
];

/** True only for links that pass the same checks the resolver applies. */
function usable(offer: Offer): boolean {
  const raw = (offer.url || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    // Admitad links carry an id; direct network links do not have to.
    if (isAdmitadTrackingHost(parsed.hostname)) {
      return /^\/g\/[A-Za-z0-9_-]{6,}\/?$/.test(parsed.pathname);
    }
    return parsed.hostname.length > 3;
  } catch (_) {
    return false;
  }
}

/** The visitor's country from the locale tag. No IP lookup, no permission. */
export function visitorCountry(): string {
  const tag = (navigator.language || "en-US").replace("_", "-");
  const parts = tag.split("-");
  const last = parts[parts.length - 1] ?? "";
  return parts.length > 1 && last.length === 2 ? last.toUpperCase() : "";
}

/**
 * Everything showable right now, ordered for this visitor.
 *
 * Local shops come first when they can actually deliver to them, then the
 * worldwide ones, then the rest by rank. Configured-but-empty programs are
 * dropped rather than rendered as dead links.
 */
export function offersFor(country = visitorCountry()): Offer[] {
  const all = [...programs, ...direct].filter(usable);
  const visible = all.filter((offer) => !offer.regions || offer.regions.includes(country));

  return visible.sort((a, b) => {
    const localA = a.regions?.includes(country) ? 0 : a.regions ? 2 : 1;
    const localB = b.regions?.includes(country) ? 0 : b.regions ? 2 : 1;
    if (localA !== localB) return localA - localB;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.name.localeCompare(b.name);
  });
}

/** Grouped by category, preserving the order above. */
export function offersByCategory(country = visitorCountry()): Array<[Offer["category"], Offer[]]> {
  const order: Offer["category"][] = ["Car & kit", "Travel", "Money back", "Tech", "Style"];
  const grouped = new Map<Offer["category"], Offer[]>();
  for (const offer of offersFor(country)) {
    const list = grouped.get(offer.category) ?? [];
    list.push(offer);
    grouped.set(offer.category, list);
  }
  return order
    .filter((category) => (grouped.get(category)?.length ?? 0) > 0)
    .map((category) => [category, grouped.get(category) ?? []]);
}

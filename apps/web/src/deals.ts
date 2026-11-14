import {
  AFFILIATE_LINKS,
  OFFER_LINKS,
  isAdmitadTrackingHost,
  type AffiliateProgram
} from "./site-constants";

/**
 * Deals for the Garage, from the programs actually joined in the account.
 *
 * Joined: AliExpress WW, Banggood WW, Airalo WW (+ LATAM), Klook WW.
 * HONOR UAE is skipped on purpose — UAE only, 0.2% conversion, 118-day payout.
 *
 * Rates shown are the program's published rates, not invented:
 *  · AliExpress WW  — mobile phone accessories 6.9%, computer peripherals 2.3%,
 *                     Hot Products 3–69%, worldwide.
 *  · Banggood WW    — 6–13%, 46-day payment term.
 *  · Airalo WW      — 7.69–11.53%, 27-day payment term (the fastest payer).
 *  · Klook WW       — 1.6–8%, 68-day payment term.
 *
 * Links are deeplinks built from the account's own affiliate link
 * (`/g/<id>/?ulp=<destination>`). A program with no link pasted yet is simply
 * not rendered — no placeholder, no invented product, no dead link.
 */

export type Deal = {
  /** A configured program, or the name of a partner offer. */
  program: AffiliateProgram | "woopdrive" | "flyfi" | "avitovip" | "lennuabi";
  title: string;
  blurb: string;
  target: string;
  rate: string;
  /** Extra line for offers that are not car parts. */
  note?: string;
  /**
   * A ready-made per-offer link from the account. When present it is used as
   * issued, because the destination is baked into the id and a deeplink would
   * either be ignored or point somewhere else.
   */
  href?: string;
  /**
   * ISO country codes this row is for. Absent means worldwide. A visitor in
   * India sees the Indian shops first and still sees the global ones, because a
   * local shop that cannot ship is worse than one that ships slowly.
   */
  regions?: string[];
};

export const DEALS: Deal[] = [
  {
    program: "aliexpress",
    title: "Phone mounts & car accessories",
    blurb: "A mount that survives a bad road. The best rate in the account.",
    target: "https://www.aliexpress.com/w/wholesale-car-phone-holder.html",
    rate: "6.9%"
  },
  {
    program: "aliexpress",
    title: "Dash cams",
    blurb: "Proof for the pothole that costs you a rim.",
    target: "https://www.aliexpress.com/w/wholesale-car-dash-cam.html",
    rate: "3–69%"
  },
  {
    program: "aliexpress",
    title: "Tire inflators & pumps",
    blurb: "Top up a soft tire in a car park, not a queue.",
    target: "https://www.aliexpress.com/w/wholesale-portable-tire-inflator.html",
    rate: "3–69%"
  },
  {
    program: "aliexpress",
    title: "Car care & wash kit",
    blurb: "Salt, mud and brake dust, handled.",
    target: "https://www.aliexpress.com/w/wholesale-car-wash-kit.html",
    rate: "3–69%"
  },
  {
    program: "aliexpress",
    title: "Lights & bulbs",
    blurb: "See the unlit stretch before it sees you.",
    target: "https://www.aliexpress.com/w/wholesale-car-led-light.html",
    rate: "3–69%"
  },
  {
    program: "banggood",
    title: "Tools & electronics",
    blurb: "Meters, compressors and gadgets — Banggood pays 6–13%.",
    target: "https://www.banggood.com/search/car-tools.html",
    rate: "6–13%"
  },
  {
    program: "airalo",
    title: "Data for the road abroad",
    blurb: "An eSIM so the map keeps working when you cross a border.",
    target: "https://www.airalo.com/",
    rate: "7.7–11.5%",
    note: "Fastest payer in the account: 27 days."
  },
  {
    program: "klook",
    title: "Things to do when you get there",
    blurb: "Tickets and activities for the other end of the drive.",
    target: "https://www.klook.com/",
    rate: "1.6–8%"
  },
  {
    program: "woopdrive",
    title: "Car hire for the road trip",
    blurb: "Rent instead of wearing your own car out on a long route.",
    target: "",
    rate: "4.2–6%",
    href: OFFER_LINKS.woopdrive
  },
  {
    program: "flyfi",
    title: "A bed at the end of the drive",
    blurb: "Hotels and stays for the overnight part of a long route.",
    target: "",
    rate: "Partner",
    href: OFFER_LINKS.flyfi
  },
  {
    program: "avitovip",
    title: "Airport transfers, fixed price",
    blurb: "The first and last leg of a road trip, without haggling at arrivals.",
    target: "",
    rate: "Partner",
    href: OFFER_LINKS.avitovip
  },
  {
    program: "lennuabi",
    title: "Cancelled flight? Claim up to €600",
    blurb: "When the road trip starts with a delay, this handles the airline.",
    target: "",
    rate: "Partner",
    href: OFFER_LINKS.lennuabi
  },
  {
    program: "hamaramall",
    title: "Car & bike kit, delivered in India",
    blurb: "Indian marketplace, domestic delivery, no customs wait.",
    target: "https://www.hamaramall.com/search?q=car+accessories",
    rate: "10.5%",
    regions: ["IN"]
  },
  {
    program: "flipkart",
    title: "Car & bike accessories in India",
    blurb: "Mounts, pumps, mats and lights with next-day delivery.",
    target: "https://www.flipkart.com/search?q=car%20accessories",
    rate: "up to 8%",
    regions: ["IN"]
  },
  {
    program: "amazonin",
    title: "Car care on Amazon India",
    blurb: "Same-day on most car care, tyres and tools.",
    target: "https://www.amazon.in/s?k=car+accessories",
    rate: "1–9%",
    regions: ["IN"]
  },
  {
    program: "cars24",
    title: "Used cars, inspected",
    blurb: "If the repair bill outweighs the car, this is the other option.",
    target: "https://www.cars24.com/",
    rate: "varies",
    regions: ["IN"]
  },
  {
    program: "tyres",
    title: "Tyres that suit these roads",
    blurb: "Tyre and alignment offers from Indian chains.",
    target: "https://www.ceat.com/",
    rate: "varies",
    regions: ["IN"]
  }
];

/** https + an Admitad tracking host + a /g/<id>/ path. */
function verifiedLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (!isAdmitadTrackingHost(parsed.hostname)) return null;
    if (!/^\/g\/[A-Za-z0-9_-]{6,}\/?$/.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

/**
 * The configured link for a program, or null when it has not been pasted.
 *
 * Two shapes are accepted, because the networks differ:
 *  · an Admitad `/g/<id>/` link, which can be pointed at any destination;
 *  · a direct affiliate URL (Amazon `?tag=`, Flipkart `affid=`, and so on),
 *    which is used exactly as given.
 */
export function affiliateBase(program: AffiliateProgram): string | null {
  const raw = AFFILIATE_LINKS[program]?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    // A direct network link (Amazon ?tag=, Flipkart affid=) is used as given.
    if (!isAdmitadTrackingHost(parsed.hostname)) return parsed.toString();
    return verifiedLink(raw);
  } catch (_) {
    return null;
  }
}

export function isAdmitad(program: AffiliateProgram): boolean {
  const raw = AFFILIATE_LINKS[program]?.trim();
  if (!raw) return false;
  try {
    return isAdmitadTrackingHost(new URL(raw).hostname);
  } catch (_) {
    return false;
  }
}

/**
 * `/g/<id>/?ulp=<destination>` for Admitad; the configured URL unchanged for a
 * direct program, because a direct link already encodes the destination.
 */
export function dealLink(program: AffiliateProgram, target: string): string | null {
  const base = affiliateBase(program);
  if (!base) return null;
  if (!isAdmitad(program)) return base;
  return `${base}?ulp=${encodeURIComponent(target)}`;
}

/** The visitor's country from the locale tag. No IP lookup, no permission. */
export function visitorCountry(): string {
  const tag = (navigator.language || "en-US").replace("_", "-");
  const parts = tag.split("-");
  const last = parts[parts.length - 1];
  return parts.length > 1 && last && last.length === 2 ? last.toUpperCase() : "";
}

/**
 * Renders the shelf and returns how many rows it added. With no program links
 * configured the page is left untouched.
 */
export function renderDealShelf(host: HTMLElement): number {
  const rows: HTMLElement[] = [];
  const country = visitorCountry();

  // Local shops first, then worldwide — and never a local shop that cannot
  // deliver to the visitor, because that is a worse answer than a slow parcel.
  const ordered = [...DEALS].sort((a, b) => {
    const rank = (deal: Deal) => (deal.regions?.includes(country) ? 0 : deal.regions ? 2 : 1);
    return rank(a) - rank(b);
  });

  for (const deal of ordered) {
    if (deal.regions && !deal.regions.includes(country)) continue;
    const href = deal.href ? verifiedLink(deal.href) : dealLink(deal.program, deal.target);
    if (!href) continue;

    const row = document.createElement("a");
    row.className = "deal-row";
    row.href = href;
    row.rel = "sponsored noopener noreferrer";
    row.target = "_blank";
    row.innerHTML = `
      <span class="deal-copy">
        <strong>${deal.title}</strong>
        <small>${deal.blurb}${deal.note ? ` ${deal.note}` : ""}</small>
      </span>
      <span class="deal-meta">${deal.href ? label(deal.program) : `${deal.rate} · ${label(deal.program)}`}</span>
      <span class="deal-arrow" aria-hidden="true">↗</span>
    `;
    rows.push(row);
  }

  if (rows.length === 0) return 0;
  host.replaceChildren(...rows);
  return rows.length;
}

const LABELS: Record<string, string> = {
  woopdrive: "WoopDrive",
  flyfi: "Flyfi",
  avitovip: "AvitoVIP",
  lennuabi: "Lennuabi",
  redmagic: "REDMAGIC",
  compensair: "Compensair",
  aliexpress: "AliExpress",
  banggood: "Banggood",
  airalo: "Airalo",
  klook: "Klook",
  hamaramall: "HamaraMall",
  flipkart: "Flipkart",
  amazonin: "Amazon India",
  cars24: "Cars24",
  tyres: "Tyres"
};

function label(program: AffiliateProgram): string {
  return LABELS[program] ?? "Shop";
}

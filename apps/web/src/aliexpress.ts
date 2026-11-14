import { ADMITAD_AFFILIATE_LINK } from "./site-constants";

/**
 * AliExpress deals for the Garage.
 *
 * The account's joined program is AliExpress WW, whose published rates make the
 * useful shelves obvious: mobile phone accessories pay 6.9%, computer
 * peripherals 2.3%, and the Hot Products feed runs 3–69%. Everything here maps
 * to a shelf drivers actually need, so the site is not carrying random stock.
 *
 * Links are deeplinks built from the account's own affiliate link
 * (`/g/<id>/?ulp=<target>`), which is how Admitad tracks a specific destination.
 * No product, price or stock is invented: the link opens AliExpress's own live
 * category page.
 */

type Deal = {
  /** Garage shelf this belongs to. */
  slot: string;
  title: string;
  blurb: string;
  /** AliExpress category or search destination. */
  target: string;
  rate: string;
};

export const DEALS: Deal[] = [
  {
    slot: "mount",
    title: "Phone mounts & car accessories",
    blurb: "A mount that survives a bad road. The best rate in the account at 6.9%.",
    target: "https://www.aliexpress.com/w/wholesale-car-phone-holder.html",
    rate: "6.9%"
  },
  {
    slot: "dashcam",
    title: "Dash cams & car cameras",
    blurb: "Proof for the pothole that costs you a rim.",
    target: "https://www.aliexpress.com/w/wholesale-car-dash-cam.html",
    rate: "3–69%"
  },
  {
    slot: "inflator",
    title: "Tire inflators & pumps",
    blurb: "Top up a soft tire in a car park, not a queue.",
    target: "https://www.aliexpress.com/w/wholesale-portable-tire-inflator.html",
    rate: "3–69%"
  },
  {
    slot: "care",
    title: "Car care & wash kit",
    blurb: "Salt, mud and brake dust, handled.",
    target: "https://www.aliexpress.com/w/wholesale-car-wash-kit.html",
    rate: "3–69%"
  },
  {
    slot: "light",
    title: "Lights & bulbs",
    blurb: "See the unlit stretch before it sees you.",
    target: "https://www.aliexpress.com/w/wholesale-car-led-light.html",
    rate: "3–69%"
  },
  {
    slot: "pressure",
    title: "Gauges & tools",
    blurb: "Read the tire before it reads the road.",
    target: "https://www.aliexpress.com/w/wholesale-digital-tire-pressure-gauge.html",
    rate: "3–69%"
  }
];

/** The account's affiliate base, or null when it has not been pasted yet. */
export function affiliateBase(): string | null {
  const raw = ADMITAD_AFFILIATE_LINK.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const admitadHost = host === "admitad.com" || host === "ad.admitad.com" || host.endsWith(".admitad.com");
    const hasId = /^\/g\/[A-Za-z0-9_-]{8,128}\/?$/.test(parsed.pathname);
    if (parsed.protocol !== "https:" || !admitadHost || !hasId) return null;
    return `https://${parsed.hostname}${parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`}`;
  } catch (_) {
    return null;
  }
}

/** `/g/<id>/?ulp=<destination>`, the documented Admitad deeplink shape. */
export function dealLink(target: string): string | null {
  const base = affiliateBase();
  if (!base) return null;
  return `${base}?ulp=${encodeURIComponent(target)}`;
}

/**
 * Renders the shelf. With no affiliate link configured it returns false and
 * leaves the page untouched — no dead links, no invented products.
 */
export function renderDealShelf(host: HTMLElement): boolean {
  if (!affiliateBase()) return false;
  host.replaceChildren();

  for (const deal of DEALS) {
    const href = dealLink(deal.target);
    if (!href) continue;

    const row = document.createElement("a");
    row.className = "deal-row";
    row.href = href;
    row.rel = "sponsored noopener noreferrer";
    row.target = "_blank";
    row.innerHTML = `
      <span class="deal-copy">
        <strong>${deal.title}</strong>
        <small>${deal.blurb}</small>
      </span>
      <span class="deal-meta">${deal.rate} · AliExpress</span>
      <span class="deal-arrow" aria-hidden="true">↗</span>
    `;
    host.append(row);
  }
  return true;
}

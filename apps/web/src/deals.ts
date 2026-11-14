import { AFFILIATE_LINKS, type AffiliateProgram } from "./site-constants";

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
  program: AffiliateProgram;
  title: string;
  blurb: string;
  target: string;
  rate: string;
  /** Extra line for offers that are not car parts. */
  note?: string;
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
  }
];

const ADMITAD_HOST = /(^|\.)admitad\.com$/i;

/** The affiliate base for one program, or null when it has not been pasted. */
export function affiliateBase(program: AffiliateProgram): string | null {
  const raw = AFFILIATE_LINKS[program]?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const hasId = /^\/g\/[A-Za-z0-9_-]{8,128}\/?$/.test(parsed.pathname);
    if (parsed.protocol !== "https:" || !ADMITAD_HOST.test(parsed.hostname) || !hasId) return null;
    const path = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `https://${parsed.hostname}${path}`;
  } catch (_) {
    return null;
  }
}

/** `/g/<id>/?ulp=<destination>`, the documented Admitad deeplink shape. */
export function dealLink(program: AffiliateProgram, target: string): string | null {
  const base = affiliateBase(program);
  if (!base) return null;
  return `${base}?ulp=${encodeURIComponent(target)}`;
}

/**
 * Renders the shelf and returns how many rows it added. With no program links
 * configured the page is left untouched.
 */
export function renderDealShelf(host: HTMLElement): number {
  const rows: HTMLElement[] = [];

  for (const deal of DEALS) {
    const href = dealLink(deal.program, deal.target);
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
      <span class="deal-meta">${deal.rate} · ${label(deal.program)}</span>
      <span class="deal-arrow" aria-hidden="true">↗</span>
    `;
    rows.push(row);
  }

  if (rows.length === 0) return 0;
  host.replaceChildren(...rows);
  return rows.length;
}

function label(program: AffiliateProgram): string {
  if (program === "aliexpress") return "AliExpress";
  if (program === "banggood") return "Banggood";
  if (program === "airalo") return "Airalo";
  return "Klook";
}

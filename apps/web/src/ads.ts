import { AD_TAG_HTML } from "./site-constants";

/**
 * Advertising, in one place.
 *
 * Two modes, and the default is ours:
 *
 *  - House promotions (default). Cards rendered from our own pages, promoting the
 *    Garage, shop placements and the web app. No third-party script, no
 *    third-party cookie, no request to an ad server. They earn by sending people
 *    to pages that do earn, which is the honest version of an ad for a product
 *    that promises not to track anyone.
 *  - Network tag, the moment one exists. Paste the code from the Mitgo product
 *    the ad space is connected to into AD_TAG_HTML and it takes the same slots.
 *
 * Rules this module enforces so an ad can never degrade the product:
 *  1. Nothing renders when nothing is configured — no empty box, no gap.
 *  2. Fill lazily, once, and never more than three slots on a page.
 *  3. The map, the web app and the Android app mount no slots at all: an ad over
 *     the road ahead is exactly what Hodos exists to avoid.
 */

const MAX_SLOTS_PER_PAGE = 3;

type HouseAd = {
  tag: string;
  title: string;
  body: string;
  cta: string;
  href: string;
};

const HOUSE_ADS: Record<string, HouseAd[]> = {
  "home-mid": [
    {
      tag: "The Garage",
      title: "Kit worth keeping in the car",
      body: "Inflators, mounts, dash cams, wipers and tires, at the shop's own price. Buying through the Garage is what keeps the map free.",
      cta: "Shop the Garage",
      href: "/garage"
    },
    {
      tag: "For shops",
      title: "Put your shop on the map",
      body: "A pin where drivers already look, from $0.19 a day in much of the world, in your own currency. Seen by riders and by their AI assistants.",
      cta: "Reserve a pin",
      href: "/partners"
    }
  ],
  "garage-below": [
    {
      tag: "From Hodos",
      title: "Drive with the app",
      body: "Hodos maps the road through the phone you already carry. On Android, or in your browser at /app — same engine, no install needed.",
      cta: "Open the web app",
      href: "/app/"
    },
    {
      tag: "For shops",
      title: "Be the shop drivers find",
      body: "One pin, one line of text, sold by the day. Cancel whenever — the pin comes down on its own when the days run out.",
      cta: "See placements",
      href: "/partners"
    }
  ]
};

let mounted = 0;
let started = false;

function networkTag(): string {
  return AD_TAG_HTML.trim();
}

function houseCard(ad: HouseAd): HTMLElement {
  const card = document.createElement("article");
  card.className = "house-ad";
  card.innerHTML = `
    <span class="house-ad-tag">${ad.tag}</span>
    <strong>${ad.title}</strong>
    <p>${ad.body}</p>
    <a class="btn btn-ghost" href="${ad.href}">${ad.cta}</a>
  `;
  return card;
}

function fill(slot: HTMLElement) {
  if (slot.dataset.filled === "true") return;
  if (mounted >= MAX_SLOTS_PER_PAGE) {
    slot.remove();
    return;
  }
  slot.dataset.filled = "true";
  mounted += 1;

  const tag = networkTag();
  if (tag) {
    // The network's own markup, injected exactly as supplied.
    slot.classList.add("ad-slot-network");
    slot.innerHTML = tag;
    return;
  }

  const ads = HOUSE_ADS[slot.dataset.adSlot ?? ""] ?? [];
  if (ads.length === 0) {
    slot.remove();
    return;
  }
  slot.classList.add("ad-slot-house");
  for (const ad of ads) slot.append(houseCard(ad));
}

/**
 * Fills every [data-ad-slot], but only as it comes into view, so nothing delays
 * the page, the map or the shelf.
 */
export function mountAdSlots(): void {
  if (started) return;
  started = true;

  const slots = Array.from(document.querySelectorAll<HTMLElement>("[data-ad-slot]"));
  if (slots.length === 0) return;

  // With neither house ads nor a network tag to show, leave no holes behind.
  if (!networkTag() && Object.keys(HOUSE_ADS).length === 0) {
    for (const slot of slots) slot.remove();
    return;
  }

  // House promos are our own static markup, so there is nothing to wait for.
  // A network tag is a third-party request, so it waits until it is nearly in
  // view, and a fallback timer guarantees it still loads on a page the reader
  // never scrolls.
  if (!networkTag()) {
    for (const slot of slots) fill(slot);
    return;
  }

  const defer = (slot: HTMLElement) => {
    if (!("IntersectionObserver" in window)) {
      fill(slot);
      return;
    }
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      fill(slot);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) run();
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(slot);
    window.setTimeout(run, 4000);
  };
  for (const slot of slots) defer(slot);
}

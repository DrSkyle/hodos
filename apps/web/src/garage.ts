import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { isValidEmail, subscribeEmail } from "./garage-client";
import { detectVisitorCountryByIp, visitorCountry } from "./offers";
import { loadLiveShops, type LiveShop } from "./live-shops";
import {
  checkedLabel,
  loadShelf,
  priceFor,
  shelfFor,
  soldLabel,
  visitorCurrency,
  type Product,
  type ShelfData
} from "./products";
import { wireThemeToggle } from "./theme";

/**
 * The Garage.
 *
 * Two genuine shelves, chosen by where the visitor is, not by a flag we flip:
 *
 *  - Nepal: the shops that actually paid for a pin on the map, and the products
 *    they chose to put here. Riders get the discount at the counter once the
 *    shop honours the pin. These are real local businesses, and the list is
 *    drawn from the live pins, so it is never stale.
 *  - Everywhere else: direct affiliate product links — a real product, a real
 *    price and a real destination, straight to the retailer. No partner store
 *    is implied, because there is no partner store outside Nepal yet.
 *
 * A shop with no working link does not appear at all, rather than as a dead
 * card, and nothing here is invented to fill a grid.
 */

wireThemeToggle("theme-toggle");

const grid = document.getElementById("shop-grid");
const status = document.getElementById("shelf-status");
const chips = document.getElementById("slot-row");
const searchInput = document.getElementById("garage-search") as HTMLInputElement | null;
const title = document.getElementById("garage-title");
const lede = document.querySelector<HTMLElement>(".garage-lede");
const perks = document.getElementById("perks-title");
const nepalReferralBanner = document.getElementById("nepal-referral-banner");

let country = visitorCountry();
let isNepal = country === "NP";
let isIndia = country === "IN";

const CATEGORIES: string[] = [
  "All",
  "Car & kit",
  "Travel",
  "Money back",
  "Tech",
  "Style"
];

/** Query string still works: /garage?slot=travel selects that category. */
const requested = (new URLSearchParams(window.location.search).get("slot") || "").toLowerCase();
const fromQuery = CATEGORIES.find(
  (category) => category.toLowerCase().replace(/[^a-z]/g, "") === requested.replace(/[^a-z]/g, "")
);
let activeCategory: string = fromQuery ?? "All";
let activeShelf = "All";
let searchQuery = "";

function setStatus(text: string, tone: "idle" | "error" = "idle") {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

/* ---- Everywhere else: direct affiliate product links ---- */

function productCard(product: Product, currency: string): HTMLElement {
  const link = document.createElement("a");
  link.className = "product-card";
  link.href = product.url;
  link.rel = "sponsored noopener noreferrer";
  link.target = "_blank";

  const price = priceFor(product, currency);
  const bought = soldLabel(product.sold);

  link.innerHTML = `
    <span class="product-card-thumb">
      ${product.image ? `<img src="" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
    </span>
    <span class="product-card-body">
      <span class="product-card-title"></span>
      <span class="product-card-meta">
        <strong class="product-card-price"></strong>
        ${bought ? `<span class="product-card-sold"></span>` : ""}
      </span>
    </span>
  `;

  // Text and attributes are set directly, so a product title can never
  // introduce markup into this page.
  const image = link.querySelector("img");
  if (image) image.src = product.image;

  const titleNode = link.querySelector(".product-card-title");
  if (titleNode) titleNode.textContent = product.title;

  const priceNode = link.querySelector(".product-card-price");
  if (priceNode) priceNode.textContent = price.amount;

  const sold = link.querySelector(".product-card-sold");
  if (sold) sold.textContent = bought;

  if (price.original) link.title = `Shop lists this at ${price.original}`;
  return link;
}

/* ---- Nepal: the shops that paid for a pin, and their own products ---- */

function shopCard(shop: LiveShop): HTMLElement {
  const card = document.createElement("article");
  card.className = "partner-card";

  const category = document.createElement("span");
  category.className = "partner-card-cat";
  category.textContent = shop.category;

  const name = document.createElement("strong");
  name.textContent = shop.name;

  const blurb = document.createElement("span");
  blurb.className = "partner-card-blurb";
  blurb.textContent = shop.summary || shop.address || "";

  card.append(category, name);
  if (blurb.textContent) card.append(blurb);

  if (shop.deals.length > 0) {
    const dealsList = document.createElement("div");
    dealsList.className = "partner-deals";
    for (const deal of shop.deals) {
      const pill = document.createElement("div");
      pill.className = "partner-deal-pill";
      const badge = document.createElement("span");
      badge.className = "partner-deal-badge";
      badge.textContent = deal.badge || "OFFER";
      const text = document.createElement("span");
      text.className = "partner-deal-title";
      text.textContent = deal.title;
      pill.append(badge, text);
      dealsList.append(pill);
    }
    card.append(dealsList);
  }

  const actions = document.createElement("div");
  actions.className = "partner-card-actions";

  if (shop.link) {
    const visit = document.createElement("a");
    visit.className = "partner-card-go";
    visit.href = shop.link;
    visit.rel = "sponsored noopener noreferrer";
    visit.target = "_blank";
    visit.textContent = "Visit ↗";
    actions.append(visit);
  } else if (shop.phone) {
    const call = document.createElement("a");
    call.className = "partner-card-go";
    call.href = `tel:${shop.phone}`;
    call.textContent = "Call ↗";
    actions.append(call);
  } else if (shop.email) {
    const email = document.createElement("a");
    email.className = "partner-card-go";
    email.href = `mailto:${shop.email}`;
    email.textContent = "Email ↗";
    actions.append(email);
  }

  const onMap = document.createElement("a");
  onMap.className = "partner-card-map";
  onMap.href = `/map/?shop=${encodeURIComponent(shop.id)}#16/${shop.lat.toFixed(5)}/${shop.lng.toFixed(5)}`;
  onMap.textContent = "See on map ↗";
  actions.append(onMap);

  card.append(actions);
  return card;
}

function buildChips(labels: string[], onPick: (label: string) => void, active: () => string) {
  if (!chips) return;
  chips.replaceChildren();
  for (const label of labels) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "slot-chip";
    chip.dataset.category = label;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(label === active()));
    chip.textContent = label;
    chip.addEventListener("click", () => onPick(label));
    chips.append(chip);
  }
}

function markChips(active: string) {
  for (const chip of chips?.querySelectorAll<HTMLButtonElement>(".slot-chip") ?? []) {
    chip.setAttribute("aria-selected", String(chip.dataset.category === active));
  }
}

/** Loaded once: switching category filters in the browser, never refetches. */
let nepalShops: LiveShop[] | null = null;

async function renderNepal() {
  if (!grid) return;
  grid.classList.remove("is-shelves");

  if (nepalShops === null) {
    // Real local shops that placed a pin on the map, with their live dashboard offers.
    nepalShops = await loadLiveShops();
    const order = ["Tyres", "Garage", "EV & Fuel", "Pharmacy", "Food & Café", "Parking", "Local Shop"];
    const uniqueCats = Array.from(new Set(nepalShops.map((shop) => shop.category))).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    const categories = ["All", ...uniqueCats];
    buildChips(categories, (label) => {
      activeCategory = label;
      void renderNepal();
    }, () => activeCategory);
  }

  const shops = nepalShops;
  const q = searchQuery.toLowerCase();
  const byCategory =
    activeCategory === "All" ? shops : shops.filter((shop) => shop.category === activeCategory);
  const shown = !q
    ? byCategory
    : byCategory.filter((shop) =>
        [shop.name, shop.category, shop.rawCategory, shop.offer, shop.address]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );

  grid.replaceChildren();
  for (const shop of shown) grid.append(shopCard(shop));

  if (shops.length === 0) {
    setStatus("0 shop pins live right now.");
    const empty = document.createElement("div");
    empty.className = "nepal-empty-card";
    empty.innerHTML = `
      <span class="garage-eyebrow">Free global launch</span>
      <h3>Be the first shop on the map — for free.</h3>
      <p>
        The Garage shows only real local shops that placed a pin on the Hodos map —
        never fake listings. Placing a shop pin is <strong>completely free initially everywhere</strong>.
        (289 people earned ₹2,00,000+ through Hodos — referrals are paused while pins are free for all shops.)
      </p>
      <div class="hero-cta-row">
        <a class="btn btn-primary" href="/partners">Place a free shop pin</a>
        <a class="btn btn-ghost" href="/referrals">Referral updates &amp; newsletter</a>
      </div>
    `;
    grid.append(empty);
  } else if (shown.length === 0) {
    setStatus("No shops on the map match that filter yet.");
  } else {
    setStatus(`${shown.length} shop${shown.length === 1 ? "" : "s"} on the map near the roads you drive`);
  }

  markChips(activeCategory);
}

/** Loaded once: switching shelf filters in the browser, never refetches. */
let worldShelf: ShelfData | null = null;

async function renderWorld() {
  if (!grid) return;
  grid.classList.add("is-shelves");

  if (worldShelf === null) {
    const data = await loadShelf();
    if (!data) {
      grid.replaceChildren();
      setStatus("The shelf is unavailable right now.", "error");
      return;
    }
    worldShelf = data;
  }
  const data = worldShelf;

  const currency = visitorCurrency();
  const shelves = shelfFor(data, 40, country);
  const labels = ["All", ...shelves.map((shelf) => shelf.shelf)];
  if (!labels.includes(activeShelf)) activeShelf = "All";
  const q = searchQuery.toLowerCase();

  grid.replaceChildren();
  let count = 0;

  for (const shelf of shelves) {
    if (activeShelf !== "All" && shelf.shelf !== activeShelf) continue;
    const filtered = !q
      ? shelf.products
      : shelf.products.filter(
          (product) =>
            product.title.toLowerCase().includes(q) || shelf.shelf.toLowerCase().includes(q)
        );
    if (filtered.length === 0) continue;

    const section = document.createElement("div");
    section.className = "product-shelf";

    const head = document.createElement("div");
    head.className = "product-shelf-head";
    const name = document.createElement("h3");
    name.textContent = shelf.shelf;
    const stamp = document.createElement("span");
    stamp.className = "product-shelf-stamp";
    stamp.textContent = `${filtered.length} picks · checked ${checkedLabel(shelf.checkedAt)}`;
    head.append(name, stamp);

    const row = document.createElement("div");
    row.className = "product-row";
    for (const product of filtered) {
      row.append(productCard(product, currency));
      count += 1;
    }

    section.append(head, row);
    grid.append(section);
  }

  setStatus(
    count === 0
      ? "Nothing in stock matching that filter right now."
      : `${count} products · prices checked ${checkedLabel(data.checkedAt)}`
  );

  if (chips && chips.childElementCount === 0) {
    buildChips(labels, (label) => {
      activeShelf = label;
      void renderWorld();
    }, () => activeShelf);
  }
  markChips(activeShelf);
}

function syncReferralBanner() {
  if (!nepalReferralBanner) return;
  if (!isNepal && !isIndia) {
    nepalReferralBanner.setAttribute("hidden", "");
    return;
  }
  nepalReferralBanner.removeAttribute("hidden");
  const eyebrow = document.getElementById("nepal-ref-eyebrow");
  const refTitle = document.getElementById("nepal-ref-title");
  const refBody = document.getElementById("nepal-ref-body");
  const refCtas = document.getElementById("nepal-ref-ctas");
  if (eyebrow) eyebrow.textContent = "Free global launch";
  if (refTitle) refTitle.textContent = "Shop pins are free initially everywhere.";
  if (refBody) {
    refBody.innerHTML =
      "Every local business in the Garage got here by putting a pin on the map. Placing a shop pin is <strong>completely free initially everywhere</strong> — no payment needed. (289 people earned ₹2,00,000+ through Hodos; referrals are paused while pins are free for all shops.)";
  }
  if (refCtas) {
    refCtas.innerHTML = `
      <a class="btn btn-primary" href="/partners">Place a free shop pin</a>
      <a class="btn btn-ghost" href="/referrals">Referral updates &amp; newsletter</a>
    `;
  }
}

function render() {
  if (isNepal || isIndia) {
    void renderNepal();
  } else {
    void renderWorld();
  }
}

/* ---- Copy: the two shelves are not the same product ---- */

syncReferralBanner();

if (searchInput) {
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    render();
  });
}

void detectVisitorCountryByIp().then((detected) => {
  country = detected;
  isNepal = country === "NP";
  isIndia = country === "IN";
  syncReferralBanner();

  if (searchInput) {
    searchInput.placeholder = isNepal || isIndia
      ? "Search shops on the map by name, road or offer…"
      : "Search products across all categories…";
  }

  if (title) {
    title.innerHTML = isNepal || isIndia
      ? "Shops on the map<span class=\"dot\">.</span>"
      : "Kit worth<br />keeping in the car<span class=\"dot\">.</span>";
  }

  if (lede) {
    lede.textContent = isNepal || isIndia
      ? "The shops that put a pin on the Hodos map, and the offers they chose to list here. Show the pin in the app at the counter and the discount is yours — these are real businesses on real roads."
      : "The things that actually save a drive — a working inflator, a mount that holds, wipers that clear. Bought straight from the shop that sells them, at the shop's own price.";
  }

  if (perks) {
    perks.textContent = isNepal || isIndia ? "Riders earn perks, not points." : "Keep the kit, skip the guesswork.";
  }

  render();
});

/* Newsletter: still the only thing a visitor is asked for. */
function wireListForm() {
  const form = document.getElementById("list-form") as HTMLFormElement | null;
  const input = document.getElementById("list-email") as HTMLInputElement | null;
  const hint = document.getElementById("list-hint");
  const button = form?.querySelector("button");
  if (!form || !input || !hint) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = input.value.trim();
    if (!isValidEmail(email)) {
      hint.textContent = "That address doesn't look complete.";
      hint.dataset.tone = "error";
      input.focus();
      return;
    }
    if (button) button.disabled = true;
    hint.textContent = "Saving…";
    hint.dataset.tone = "";
    try {
      await subscribeEmail(email, "web-garage");
      form.reset();
      hint.textContent = "You're on the list. No spam, just road notes and deals.";
      hint.dataset.tone = "ok";
    } catch (_) {
      hint.textContent = "Couldn't save that just now — try again in a moment.";
      hint.dataset.tone = "error";
    } finally {
      if (button) button.disabled = false;
    }
  });
}

wireListForm();

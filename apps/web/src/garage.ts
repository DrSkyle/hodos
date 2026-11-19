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
  // A shop with its own link goes there. Otherwise the card is not clickable:
  // the reason to visit is the counter, not a website.
  const card: HTMLElement = shop.link ? document.createElement("a") : document.createElement("div");
  card.className = "partner-card";

  if (shop.link) {
    (card as HTMLAnchorElement).href = shop.link;
    (card as HTMLAnchorElement).rel = "sponsored noopener noreferrer";
    (card as HTMLAnchorElement).target = "_blank";
  }

  const category = document.createElement("span");
  category.className = "partner-card-cat";
  category.textContent = shop.category;

  const name = document.createElement("strong");
  name.textContent = shop.name;

  const blurb = document.createElement("span");
  blurb.className = "partner-card-blurb";
  blurb.textContent = shop.offer || shop.address || "";

  // Only the shop's own published details: a rider redeeming a perk needs to
  // reach the shop, and nothing else about them is shown.
  const go = document.createElement(shop.link ? "span" : "a");
  go.className = "partner-card-go";
  if (shop.link) {
    go.textContent = "Visit ↗";
  } else if (shop.phone) {
    (go as HTMLAnchorElement).href = `tel:${shop.phone}`;
    go.textContent = "Call ↗";
  } else if (shop.email) {
    (go as HTMLAnchorElement).href = `mailto:${shop.email}`;
    go.textContent = "Email ↗";
  } else {
    go.textContent = "On the map ↗";
  }

  card.append(category, name, blurb, go);
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
    // The shops that actually paid for a pin on the map. Not an affiliate
    // programme, not a partner logo wall: local businesses a rider can walk into.
    nepalShops = await loadLiveShops();
    // Chips reflect what is actually on the map right now, not a fixed list.
    const categories = ["All", ...Array.from(new Set(nepalShops.map((shop) => shop.category)))];
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
        [shop.name, shop.category, shop.offer, shop.address]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );

  grid.replaceChildren();
  for (const shop of shown) grid.append(shopCard(shop));

  if (shops.length === 0) {
    setStatus("0 paid shop pins live in Nepal right now.");
    const empty = document.createElement("div");
    empty.className = "nepal-empty-card";
    empty.innerHTML = `
      <span class="garage-eyebrow">Nepal Garage · Pin-powered</span>
      <h3>Be the first shop on the map in Nepal.</h3>
      <p>
        In Nepal, the Garage shows only real local shops that placed a pin on the Hodos map —
        never fake listings. Put your workshop, café, pharmacy or store on the map from
        <strong>~NPR 26/day</strong>, or introduce a shop and keep <strong>60%</strong> of every payment.
      </p>
      <div class="hero-cta-row">
        <a class="btn btn-primary" href="/partners">Place a shop pin</a>
        <a class="btn btn-ghost" href="/referrals">Refer a shop · earn 60%</a>
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

function render() {
  if (isNepal) {
    void renderNepal();
  } else {
    void renderWorld();
  }
}

/* ---- Copy: the two shelves are not the same product ---- */

if (isNepal && nepalReferralBanner) {
  nepalReferralBanner.removeAttribute("hidden");
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    render();
  });
}

void detectVisitorCountryByIp().then((detected) => {
  country = detected;
  isNepal = country === "NP";

  if (searchInput) {
    searchInput.placeholder = isNepal
      ? "Search shops on the map by name, road or offer…"
      : "Search products across all categories…";
  }

  if (title) {
    title.innerHTML = isNepal
      ? "Shops on the map<span class=\"dot\">.</span>"
      : "Kit worth<br />keeping in the car<span class=\"dot\">.</span>";
  }

  if (lede) {
    lede.textContent = isNepal
      ? "The shops that put a pin on the Hodos map, and the offers they chose to list here. Show the pin in the app at the counter and the discount is yours — these are real businesses on real roads."
      : "The things that actually save a drive — a working inflator, a mount that holds, wipers that clear. Bought straight from the shop that sells them, at the shop's own price.";
  }

  if (perks) {
    perks.textContent = isNepal ? "Riders earn perks, not points." : "Keep the kit, skip the guesswork.";
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

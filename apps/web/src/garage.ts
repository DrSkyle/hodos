import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { mountAdSlots } from "./ads";
import { offerConsentIfNeeded, wireAffiliateLinks } from "./teleport";
import { isValidEmail, subscribeEmail } from "./garage-client";
import { offersFor, visitorCountry, type Offer } from "./offers";

/**
 * The Garage.
 *
 * Every row is a shop the account actually has a working link for, named for the
 * shop it opens. There is no product catalogue behind it: the links carry no
 * product data, so nothing here claims a price or a stock level. A shop with no
 * link yet does not appear at all, rather than appearing as a dead card.
 */

const grid = document.getElementById("shop-grid");
const status = document.getElementById("shelf-status");
const chips = document.getElementById("slot-row");

const CATEGORIES: Array<Offer["category"] | "All"> = [
  "All",
  "Car & kit",
  "Travel",
  "Money back",
  "Tech",
  "Style"
];

/** Query string still works: /garage?slot=travel selects that category. */
const requested = (new URLSearchParams(window.location.search).get("slot") || "").toLowerCase();
const fromQuery = CATEGORIES.find((category) => category.toLowerCase().replace(/[^a-z]/g, "") === requested.replace(/[^a-z]/g, ""));
let activeCategory: Offer["category"] | "All" = fromQuery ?? "All";

function setStatus(text: string, tone: "idle" | "error" = "idle") {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function card(offer: Offer): HTMLElement {
  const link = document.createElement("a");
  link.className = "partner-card";
  link.href = offer.url;
  link.rel = "sponsored noopener noreferrer";
  link.target = "_blank";

  const category = document.createElement("span");
  category.className = "partner-card-cat";
  category.textContent = offer.category;

  const name = document.createElement("strong");
  name.textContent = offer.name;

  const blurb = document.createElement("span");
  blurb.className = "partner-card-blurb";
  blurb.textContent = offer.blurb;

  const go = document.createElement("span");
  go.className = "partner-card-go";
  go.textContent = "Visit ↗";

  link.append(category, name, blurb, go);
  return link;
}

function render() {
  if (!grid) return;
  const country = visitorCountry();
  const all = offersFor(country);
  const shown = activeCategory === "All" ? all : all.filter((offer) => offer.category === activeCategory);

  grid.replaceChildren();
  for (const offer of shown) grid.append(card(offer));

  const local = shown.filter((offer) => offer.regions?.includes(country)).length;
  if (shown.length === 0) {
    setStatus("No shops in this category yet.");
  } else if (local > 0) {
    setStatus(`${shown.length} shops · ${local} local to you`);
  } else {
    setStatus(`${shown.length} shops`);
  }

  for (const chip of chips?.querySelectorAll<HTMLButtonElement>(".slot-chip") ?? []) {
    chip.setAttribute("aria-selected", String(chip.dataset.category === activeCategory));
  }

  // Consent and click enrichment for the links just rendered.
  if (shown.length > 0) {
    offerConsentIfNeeded();
    wireAffiliateLinks();
  }
}

function buildChips() {
  if (!chips) return;
  for (const category of CATEGORIES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "slot-chip";
    chip.dataset.category = category;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(category === activeCategory));
    chip.textContent = category;
    chip.addEventListener("click", () => {
      activeCategory = category;
      render();
    });
    chips.append(chip);
  }
}

buildChips();
render();

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
mountAdSlots();

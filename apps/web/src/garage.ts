import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { mountAdSlots } from "./ads";
import { offerConsentIfNeeded, wireAffiliateLinks } from "./teleport";
import {
  DEFAULT_GARAGE_SLOT_ID,
  GARAGE_SLOTS,
  isGarageSlot,
  isValidEmail,
  loadOffers,
  money,
  offerMeta,
  subscribeEmail,
  wasPrice,
  type GearOffer
} from "./garage-client";

/**
 * The Garage — Hodos' affiliate shelf.
 *
 * Every card is a real catalogue product fetched through the hodos-affiliate
 * function; there is no bundled sample data. If the catalogue or the network
 * is unavailable the page says so instead of filling the shelf with filler.
 */

const slotRow = document.getElementById("slot-row");
const list = document.getElementById("offer-list");
const status = document.getElementById("shelf-status");

const requested = new URLSearchParams(window.location.search).get("slot");
let activeSlot = isGarageSlot(requested) ? requested : DEFAULT_GARAGE_SLOT_ID;
let requestId = 0;

function setStatus(text: string, tone: "idle" | "error" = "idle") {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function skeleton() {
  if (!list) return;
  list.replaceChildren();
  for (let i = 0; i < 4; i += 1) {
    const bar = document.createElement("div");
    bar.className = "offer-skeleton";
    list.append(bar);
  }
}

function offerRow(offer: GearOffer): HTMLElement {
  const row = document.createElement("article");
  row.className = "offer-row";

  if (offer.image) {
    const image = document.createElement("img");
    image.className = "offer-thumb";
    image.src = offer.image;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    row.append(image);
  }

  const body = document.createElement("div");
  body.className = "offer-body";

  const title = document.createElement("div");
  title.className = "offer-title";
  title.textContent = offer.title;
  body.append(title);

  const meta = document.createElement("div");
  meta.className = "offer-meta";
  meta.textContent = offerMeta(offer);
  if (meta.textContent) body.append(meta);

  const price = document.createElement("div");
  price.className = "offer-price";
  price.textContent = money(offer.price, offer.currency);
  const before = wasPrice(offer);
  if (before) {
    const was = document.createElement("s");
    was.textContent = before;
    price.append(was);
  }
  if (price.textContent) body.append(price);

  row.append(body);

  const cta = document.createElement("a");
  cta.className = "offer-cta";
  cta.href = offer.url;
  cta.target = "_blank";
  cta.rel = "sponsored noopener noreferrer";
  const longLabel = document.createElement("span");
  longLabel.className = "cta-long";
  longLabel.textContent = "View offer ↗";
  const shortLabel = document.createElement("span");
  shortLabel.className = "cta-short";
  shortLabel.textContent = "Open ↗";
  cta.append(longLabel, shortLabel);
  row.append(cta);

  return row;
}

async function loadSlot(slot: string) {
  activeSlot = slot;
  requestId += 1;
  const current = requestId;
  document.querySelectorAll<HTMLButtonElement>(".slot-chip").forEach((chip) => {
    chip.setAttribute("aria-selected", String(chip.dataset.slot === slot));
  });
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("slot", slot);
  window.history.replaceState(null, "", nextUrl);
  skeleton();
  setStatus("Checking the shelf…");

  try {
    const products = await loadOffers(slot);
    if (current !== requestId) return;
    if (!list) return;
    list.replaceChildren();
    if (products.length === 0) {
      setStatus("Nothing on this shelf right now.");
      return;
    }
    for (const offer of products) list.append(offerRow(offer));
    setStatus(`${products.length} picks · prices update from the shops`);
  } catch (_) {
    if (current !== requestId) return;
    if (list) list.replaceChildren();
    setStatus("The shelf is unreachable right now. Try again in a moment.", "error");
  }
}

function buildChips() {
  if (!slotRow) return;
  for (const slot of GARAGE_SLOTS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "slot-chip";
    chip.dataset.slot = slot.id;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(slot.id === activeSlot));
    chip.textContent = slot.label;
    chip.addEventListener("click", () => void loadSlot(slot.id));
    slotRow.append(chip);
  }
}

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

buildChips();
wireListForm();
void loadSlot(activeSlot).then(() => {
  // Affiliate links are only enriched once the reader has agreed.
  offerConsentIfNeeded();
  wireAffiliateLinks();
});
mountAdSlots();

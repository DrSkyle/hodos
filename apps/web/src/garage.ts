import "./cartographic.css";
import "./garage.css";
import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  GARAGE_FUNCTION
} from "./site-constants";

/**
 * The Garage — Hodos' affiliate shelf.
 *
 * Every card is a real catalogue product fetched through the hodos-affiliate
 * function; there is no bundled sample data. If the catalogue or the network
 * is unavailable the page says so instead of filling the shelf with filler.
 */

type GearOffer = {
  id: string;
  title: string;
  brand: string | null;
  image: string | null;
  price: number | null;
  compareAt: number | null;
  currency: string;
  merchant: string | null;
  url: string;
};

type OffersResponse = {
  ok: boolean;
  slot?: string;
  label?: string;
  products?: GearOffer[];
  error?: string;
};

const SLOTS: { id: string; label: string }[] = [
  { id: "inflator", label: "Tire inflator" },
  { id: "mount", label: "Phone mount" },
  { id: "dashcam", label: "Dash cam" },
  { id: "pressure", label: "Pressure gauge" },
  { id: "care", label: "Wash kit" },
  { id: "wipers", label: "Wipers" },
  { id: "tires", label: "Tires" },
  { id: "light", label: "Lights" }
];

const endpoint = `${APPWRITE_ENDPOINT}/functions/${GARAGE_FUNCTION}/executions`;

const slotRow = document.getElementById("slot-row");
const list = document.getElementById("offer-list");
const status = document.getElementById("shelf-status");

let activeSlot = SLOTS[0].id;
let requestId = 0;

function callFunction(payload: Record<string, unknown>): Promise<unknown> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({
      body: JSON.stringify(payload),
      method: "POST",
      path: "/"
    })
  }).then(async (response) => {
    if (!response.ok) throw new Error(`backend ${response.status}`);
    const execution = await response.json();
    const inner = execution?.responseBody;
    if (typeof inner !== "string") throw new Error("empty response");
    return JSON.parse(inner);
  });
}

function setStatus(text: string, tone: "idle" | "error" = "idle") {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function money(value: number | null, currency: string): string {
  if (value === null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2
    }).format(value);
  } catch (_) {
    return `${value.toFixed(2)} ${currency}`;
  }
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
  meta.textContent = [offer.brand, offer.merchant].filter(Boolean).join(" · ");
  if (meta.textContent) body.append(meta);

  const price = document.createElement("div");
  price.className = "offer-price";
  price.textContent = money(offer.price, offer.currency);
  if (offer.compareAt && offer.price !== null && offer.compareAt > offer.price) {
    const was = document.createElement("s");
    was.textContent = money(offer.compareAt, offer.currency);
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
  skeleton();
  setStatus("Checking the shelf…");

  try {
    const data = (await callFunction({ action: "offers", slot })) as OffersResponse;
    if (current !== requestId) return;
    if (!data?.ok) throw new Error(data?.error || "unavailable");
    const products = data.products ?? [];
    if (!list) return;
    list.replaceChildren();
    if (products.length === 0) {
      setStatus("Nothing on this shelf right now.");
      return;
    }
    for (const offer of products) list.append(offerRow(offer));
    setStatus(`${products.length} picks · prices update from the shops`);
  } catch (error) {
    if (current !== requestId) return;
    if (list) list.replaceChildren();
    setStatus("The shelf is unreachable right now. Try again in a moment.", "error");
  }
}

function buildChips() {
  if (!slotRow) return;
  for (const slot of SLOTS) {
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      hint.textContent = "That address doesn't look complete.";
      hint.dataset.tone = "error";
      input.focus();
      return;
    }
    if (button) button.disabled = true;
    hint.textContent = "Saving…";
    hint.dataset.tone = "";
    try {
      const result = (await callFunction({
        action: "subscribe",
        email,
        source: "web-garage"
      })) as { ok: boolean; error?: string };
      if (!result?.ok) throw new Error(result?.error || "failed");
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
void loadSlot(activeSlot);

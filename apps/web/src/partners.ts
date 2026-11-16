import "./cartographic.css";
import "./garage.css";
import "./partners.css";
import "./pwa";
import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  BILLING_EMAIL
} from "./site-constants";
import { setWorkerUrl, Map, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Same self-hosted worker as the live map, so Vite's asset hashing cannot
// break the placement map.
setWorkerUrl("/maplibre-gl-worker.js");

/**
 * Self-serve shop placement.
 *
 * One pin, one line of text, sold by the day at the same USD price everywhere
 * and quoted in the buyer's own currency. No account: the shop describes the
 * placement, gets a quote, and pays by reference. The pin appears once the
 * payment clears and disappears when the days run out.
 */

const ENDPOINT = `${APPWRITE_ENDPOINT}/functions/hodos-api/executions`;

type Quote = {
  ok: boolean;
  country?: string | null;
  tier?: "high" | "mid" | "low";
  currency: string;
  baseUsdPerDay?: number;
  usdPerDay: number;
  baseLocalPerDay?: number;
  localPerDay: number;
  discountPct?: number;
  weeksFrom?: number;
  days: number;
  totalLocal: number;
  totalUsd: number;
  note?: string;
  settlement?: string;
  error?: string;
};

const DAY_OPTIONS = [1, 3, 7, 14, 30, 90, 180, 365];

let days = 1;
let quote: Quote | null = null;
let point: { lat: number; lng: number } | null = null;

async function callApi(payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({ body: JSON.stringify(payload), method: "POST", path: "/" })
  });
  const execution = await response.json();
  const inner = execution?.responseBody;
  if (typeof inner !== "string") throw new Error("empty response");
  return JSON.parse(inner);
}

function browserLocale(): string {
  // Never a network lookup: the browser already knows the shop's locale and time zone.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^Asia\/Kath?mandu$/i.test(tz) || new Date().getTimezoneOffset() === -345) {
      return "ne-NP";
    }
  } catch (_) {
    // ignore
  }
  return navigator.language || "en-US";
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(browserLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: value < 1 ? 3 : 2
    }).format(value);
  } catch (_) {
    return `${value} ${currency}`;
  }
}

const priceHost = document.getElementById("price-line");
const priceNote = document.getElementById("price-note");
const dayRow = document.getElementById("day-row");
const statusEl = document.getElementById("form-status");
const form = document.getElementById("placement-form") as HTMLFormElement | null;
const pinLabel = document.getElementById("pin-label");

function setStatus(text: string, tone: "idle" | "ok" | "error" = "idle") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function renderQuote() {
  if (!priceHost) return;
  if (!quote) {
    priceHost.textContent = "…";
    return;
  }
  const hasDiscount = Number(quote.discountPct) > 0 && quote.baseLocalPerDay && quote.baseLocalPerDay > quote.localPerDay;
  if (hasDiscount && quote.baseLocalPerDay) {
    priceHost.innerHTML = `${money(quote.localPerDay, quote.currency)} a day <s style="font-size:0.52em;font-weight:600;color:var(--muted);margin-left:8px;">${money(quote.baseLocalPerDay, quote.currency)}</s>`;
  } else {
    priceHost.textContent = `${money(quote.localPerDay, quote.currency)} a day`;
  }

  if (priceNote) {
    const total = money(quote.totalLocal, quote.currency);
    const tierName = quote.tier === "low" ? "Access" : quote.tier === "mid" ? "Local" : "Standard";
    const saveTag = Number(quote.discountPct) > 0 ? `save ${quote.discountPct}%` : "longer plans cost less per day";
    const spanLabel = quote.days === 365 ? "1 year" : `${quote.days} days`;
    priceNote.textContent =
      quote.days === 1
        ? `Base 1-day rate · ${saveTag} when you pick 3 days to 1 year · ${tierName} tier`
        : `${total} for ${spanLabel} · ${saveTag} · ${tierName} tier`;
  }

  const isNepal = quote.country === "NP" || browserLocale() === "ne-NP";
  const refLabel = document.getElementById("payment-reference-label");
  const refInput = document.getElementById("payment-reference-input") as HTMLInputElement | null;
  const refHelp = document.getElementById("payment-help");
  if (isNepal) {
    if (refLabel) refLabel.textContent = "eSewa / Khalti / IME Pay transaction ID";
    if (refInput) refInput.placeholder = "Your eSewa, Khalti or IME Pay transaction ID";
    if (refHelp) {
      refHelp.innerHTML = `Email <a href="mailto:${BILLING_EMAIL}?subject=Hodos%20Nepal%20shop%20pin%20payment">${BILLING_EMAIL}</a> to get our eSewa, Khalti or IME Pay details (tell us your shop name and who referred you), then paste your transaction ID here.`;
    }
  } else {
    if (refLabel) refLabel.textContent = "Payment reference";
    if (refInput) refInput.placeholder = "Card, Payoneer or PayPal reference";
    if (refHelp) {
      refHelp.innerHTML = `Email <a href="mailto:${BILLING_EMAIL}?subject=Hodos%20shop%20placement%20payment%20details">${BILLING_EMAIL}</a> for payment details, then paste your reference here.`;
    }
  }

  document.querySelectorAll<HTMLButtonElement>(".day-chip").forEach((chip) => {
    chip.setAttribute("aria-selected", String(Number(chip.dataset.days) === days));
  });
}

async function refreshQuote() {
  try {
    const next = (await callApi({
      action: "partnerQuote",
      locale: browserLocale(),
      days
    })) as Quote;
    if (!next.ok) throw new Error(next.error || "quote failed");
    quote = next;
    renderQuote();
  } catch (_) {
    if (priceHost) priceHost.textContent = "$0.99 a day";
    if (priceNote) priceNote.textContent = "Quoted in your local currency at checkout.";
  }
}

function buildDayChips() {
  if (!dayRow) return;
  for (const option of DAY_OPTIONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip";
    chip.dataset.days = String(option);
    chip.setAttribute("role", "tab");
    chip.textContent = option === 1 ? "1 day" : option === 365 ? "1 year" : `${option} days`;
    chip.addEventListener("click", () => {
      days = option;
      void refreshQuote();
    });
    dayRow.append(chip);
  }
}

function buildMap() {
  const host = document.getElementById("pin-map");
  if (!host) return;
  const map = new Map({
    container: host,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
        }
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }]
    },
    center: [10, 24],
    zoom: 1.8,
    minZoom: 1.5,
    maxZoom: 19,
    renderWorldCopies: false,
    attributionControl: { compact: true }
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");

  let marker: Marker | null = null;
  map.on("click", (event) => {
    point = { lat: event.lngLat.lat, lng: event.lngLat.lng };
    if (marker) marker.remove();
    marker = new Marker({ color: "#d97706" })
      .setLngLat(event.lngLat)
      .addTo(map);
    if (pinLabel) {
      pinLabel.textContent = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
      pinLabel.dataset.tone = "ok";
    }
  });

  const locate = document.getElementById("use-my-location");
  locate?.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setStatus("This browser has no location support — tap the map instead.", "error");
      return;
    }
    setStatus("Finding your shop…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        point = { lat: latitude, lng: longitude };
        if (marker) marker.remove();
        marker = new Marker({ color: "#d97706" })
          .setLngLat([longitude, latitude])
          .addTo(map);
        map.flyTo({ center: [longitude, latitude], zoom: 14 });
        if (pinLabel) {
          pinLabel.textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          pinLabel.dataset.tone = "ok";
        }
        setStatus("Pin placed. Adjust it by tapping the map.");
      },
      () => setStatus("Couldn't read your location — tap the map instead.", "error"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/**
 * The result is a state, not a sentence: the pin is either live (paid, with an
 * expiry) or the payment reference is missing, and either way there is a next
 * step to tap.
 */
function showResult(order: {
  live: boolean;
  activeUntil: string | null;
  placement: string;
  amount: string;
  days: number;
  next: string;
}) {
  const host = document.getElementById("placement-result");
  if (!host) return;
  const until = order.activeUntil ? new Date(order.activeUntil) : null;
  const untilText = until
    ? until.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  host.innerHTML = `
    <div class="result-card${order.live ? " is-live" : ""}">
      <span class="result-tag">${order.live ? "Live now" : "Payment needed"}</span>
      <strong>${order.live ? "Your pin is on the map" : "Your pin is not on the map yet"}</strong>
      <p>${
        order.live
          ? `Visible to riders and to AI assistants until ${untilText}. It comes down on its own when the days run out.`
          : `${order.amount} for ${order.days}. ${order.next}`
      }</p>
      <div class="field" style="margin-top: 14px;">
        <span class="field-label">Extend your pin · payment reference</span>
        <input id="extend-reference" type="text" maxlength="120" placeholder="Transaction reference for the added days" />
      </div>
      <div class="btn-row">
        <a class="btn btn-primary" href="/map/">See it on the map</a>
        <button class="btn btn-ghost" type="button" data-extend="7">Add 7 paid days</button>
        <button class="btn btn-ghost" type="button" data-extend="30">Add 30 paid days</button>
      </div>
      <p class="result-ref">Reference: ${order.placement} · billing: ${BILLING_EMAIL}</p>
    </div>
  `;
  host.hidden = false;
  host.scrollIntoView({ behavior: "smooth", block: "center" });

  host.querySelectorAll<HTMLButtonElement>("[data-extend]").forEach((button) => {
    button.addEventListener("click", async () => {
      const days = Number(button.dataset.extend) || 7;
      const refInput = host.querySelector<HTMLInputElement>("#extend-reference");
      const reference = String(refInput?.value || "").trim();
      if (reference.length < 4) {
        setStatus("Enter the payment reference for the added days so we can extend the pin and credit your referrer.", "error");
        refInput?.focus();
        return;
      }
      button.disabled = true;
      try {
        const result = await callApi({
          action: "partnerExtend",
          placement: order.placement,
          days,
          reference,
          locale: browserLocale()
        });
        if (!result.ok) throw new Error(result.error || "failed");
        setStatus("Pin extended and referral share credited.", "ok");
        showResult({
          live: Boolean(result.live),
          activeUntil: String(result.activeUntil || ""),
          placement: order.placement,
          amount: money(Number(result.owedLocal) || 0, String(result.currency)),
          days: Number(result.days) || days,
          next: String(result.next || "")
        });
      } catch (error) {
        setStatus(`Couldn't extend that — ${String(error).replace("Error: ", "")}`, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function prefillReferralFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get("ref") || params.get("referral") || params.get("code") || "").trim().toLowerCase();
    if (!ref) return;
    const input = document.getElementById("referral-code-input") as HTMLInputElement | null;
    if (input && !input.value) {
      input.value = ref;
    }
  } catch (_) {
    // ignore
  }
}

function wireForm() {
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const offer = String(data.get("offer") || "").trim();
    const address = String(data.get("address") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const email = String(data.get("email") || "").trim();
    const reference = String(data.get("reference") || "").trim();

    if (name.length < 3) return setStatus("Add the shop's real name, as it is on the door.", "error");
    if (offer.length < 8) return setStatus("Describe in one line what the shop offers.", "error");
    if (address.length < 5) return setStatus("Add the street address of the shop.", "error");
    // A placement nobody can call is not a shop: the phone number is mandatory
    // and must look like one, exactly as the server validates it.
    const digits = phone.replace(/[()\s-]/g, "");
    if (!/^\+?[0-9][0-9\s-]{6,19}$/.test(digits)) {
      return setStatus("Add a phone number the shop actually answers.", "error");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      return setStatus("That email address doesn't look complete.", "error");
    }
    if (reference.length < 4) return setStatus("Add the payment reference so we can match your pay-in.", "error");
    if (!point) return setStatus("Tap the map to place your shop.", "error");

    const button = form.querySelector("button[type=submit]") as HTMLButtonElement | null;
    if (button) button.disabled = true;
    setStatus("Recording your placement…");

    try {
      const result = await callApi({
        action: "partnerPlace",
        name,
        offer,
        address,
        phone,
        email,
        category: String(data.get("category") || "").trim() || "business",
        link: String(data.get("link") || "").trim(),
        lat: point.lat,
        lng: point.lng,
        days,
        reference,
        referralCode: String(data.get("referralCode") || "").trim().toLowerCase(),
        locale: browserLocale()
      });
      if (!result.ok) throw new Error(result.error || "failed");
      form.reset();
      showResult({
        live: Boolean(result.live),
        activeUntil: result.activeUntil as string | null,
        placement: String(result.placement || ""),
        amount: money(result.totalLocal, result.currency),
        days: Number(result.days) || days,
        next: String(result.next || "")
      });
    } catch (error) {
      setStatus(`Couldn't record that — ${String(error).replace("Error: ", "")}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}

buildDayChips();
buildMap();
prefillReferralFromUrl();
wireForm();
void refreshQuote();

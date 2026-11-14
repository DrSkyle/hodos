import "./cartographic.css";
import "./partners.css";
import "./pwa";
import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID
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
  usdPerDay: number;
  localPerDay: number;
  weeksFrom?: number;
  days: number;
  totalLocal: number;
  totalUsd: number;
  note?: string;
  settlement?: string;
  error?: string;
};

const DAY_OPTIONS = [1, 3, 7, 14, 30];

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
  // Never a network lookup: the browser already knows the shop's locale.
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
  priceHost.textContent = `${money(quote.localPerDay, quote.currency)} a day`;
  if (priceNote) {
    const total = money(quote.totalLocal, quote.currency);
    const week = quote.weeksFrom
      ? `${money(quote.weeksFrom, quote.currency)} a week`
      : `about $${(quote.usdPerDay * 7).toFixed(2)} USD a week`;
    const tierName = quote.tier === "low" ? "Access" : quote.tier === "mid" ? "Local" : "Standard";
    priceNote.textContent =
      quote.days === 1
        ? `${week} · ${tierName} tier · no account, no contract`
        : `${total} for ${quote.days} days · ${week} · ${tierName} tier`;
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
    chip.textContent = option === 1 ? "1 day" : `${option} days`;
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
    center: [85.3, 27.7],
    zoom: 3,
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

function wireForm() {
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const offer = String(data.get("offer") || "").trim();
    const contact = String(data.get("contact") || "").trim();

    if (name.length < 2) return setStatus("Add the shop name.", "error");
    if (offer.length < 2) return setStatus("Add the line you want on the pin.", "error");
    if (!point) return setStatus("Tap the map to place your shop.", "error");

    const button = form.querySelector("button[type=submit]") as HTMLButtonElement | null;
    if (button) button.disabled = true;
    setStatus("Recording your placement…");

    try {
      const result = await callApi({
        action: "partnerPlace",
        name,
        offer,
        contact,
        category: data.get("category") || "pit-stop",
        lat: point.lat,
        lng: point.lng,
        days,
        locale: browserLocale()
      });
      if (!result.ok) throw new Error(result.error || "failed");
      setStatus(
        `Placement ${result.placement} reserved · ${money(result.totalLocal, result.currency)} for ${result.days} day${result.days === 1 ? "" : "s"}. Send the payment reference to go live.`,
        "ok"
      );
      form.reset();
    } catch (error) {
      setStatus(`Couldn't record that — ${String(error).replace("Error: ", "")}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}

buildDayChips();
buildMap();
wireForm();
void refreshQuote();

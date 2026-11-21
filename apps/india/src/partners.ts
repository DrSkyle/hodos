import "./cartographic.css";
import "./garage.css";
import "./partners.css";
import "./pwa";
import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  BILLING_EMAIL,
  INDIA_API_FUNCTION
} from "./site-constants";
import { setWorkerUrl, Map, Marker, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { wireThemeToggle } from "./theme";

setWorkerUrl("/maplibre-gl-worker.js");
wireThemeToggle("theme-toggle");

const ENDPOINT = `${APPWRITE_ENDPOINT}/functions/${INDIA_API_FUNCTION}/executions`;
const DAY_OPTIONS = [1, 3, 7, 14, 30, 90, 180, 365];
const BASE_USD_DAY = 0.19;
const FX_INR = 84;

function durationFactor(d: number): number {
  if (d >= 365) return 0.6;
  if (d >= 180) return 0.7;
  if (d >= 90) return 0.78;
  if (d >= 30) return 0.85;
  if (d >= 14) return 0.9;
  if (d >= 7) return 0.93;
  if (d >= 3) return 0.97;
  return 1;
}

let days = 30;
let point: { lat: number; lng: number } | null = null;

const priceHost = document.getElementById("price-line");
const priceNote = document.getElementById("price-note");
const dayRow = document.getElementById("day-row");
const statusEl = document.getElementById("form-status");
const form = document.getElementById("placement-form") as HTMLFormElement | null;
const pinLabel = document.getElementById("pin-label");
const refInput = document.getElementById("referral-code-input") as HTMLInputElement | null;

// Pre-fill ?ref=<code> from referral link
const urlRef = new URLSearchParams(window.location.search).get("ref");
if (urlRef && refInput) {
  refInput.value = urlRef.trim().toLowerCase();
}

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function localQuote(d: number) {
  const factor = durationFactor(d);
  const perDayInr = BASE_USD_DAY * factor * FX_INR;
  const totalInr = Math.round(perDayInr * d);
  const discountPct = Math.round((1 - factor) * 100);
  return { perDayInr: Math.round(perDayInr), totalInr, discountPct };
}

function renderPricing() {
  const q = localQuote(days);
  const span = days === 365 ? "1 year" : `${days} day${days === 1 ? "" : "s"}`;
  if (priceHost) {
    priceHost.textContent = days === 1 ? `₹${inrFmt.format(q.totalInr)} / day` : `₹${inrFmt.format(q.totalInr)} for ${span}`;
  }
  if (priceNote) {
    const discountText = q.discountPct > 0 ? ` (${q.discountPct}% longer-plan discount · ~₹${q.perDayInr}/day)` : "";
    priceNote.textContent = `Quoted in INR (₹)${discountText}. Pay via UPI or IMPS.`;
  }
  if (dayRow) {
    dayRow.innerHTML = "";
    for (const opt of DAY_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calc-plan";
      btn.textContent = opt === 365 ? "1 yr" : `${opt}d`;
      btn.setAttribute("aria-pressed", String(opt === days));
      btn.addEventListener("click", () => {
        days = opt;
        renderPricing();
      });
      dayRow.appendChild(btn);
    }
  }
}

renderPricing();

function setStatus(text: string, tone: "idle" | "ok" | "error" = "idle") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function buildMailtoHref(): string {
  const data = form ? new FormData(form) : null;
  const shopName = String(data?.get("name") || "").trim();
  const offer = String(data?.get("offer") || "").trim();
  const category = String(data?.get("category") || "").trim();
  const address = String(data?.get("address") || "").trim();
  const phone = String(data?.get("phone") || "").trim();
  const referralCode = String(data?.get("referralCode") || "").trim();
  const q = localQuote(days);
  const spanLabel = days === 365 ? "1 year" : `${days} day${days === 1 ? "" : "s"}`;
  const coordsLine = point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "(not pinned on map yet)";

  const subject = shopName
    ? `Hodos India shop pin — ${shopName}`
    : "Hodos India shop pin — UPI / IMPS payment details";

  const bodyLines = [
    "Namaste Hodos India team,",
    "",
    "Please send us your UPI / IMPS payment details so we can put our shop pin on the Hodos map.",
    "",
    `Shop name: ${shopName}`,
    `One line / offer: ${offer}`,
    `Category: ${category}`,
    `Address: ${address}`,
    `Phone / WhatsApp: ${phone}`,
    `Plan: ${spanLabel} (₹${inrFmt.format(q.totalInr)})`,
    `Map location: ${coordsLine}`,
    `Referred by (code): ${referralCode || "none"}`,
    "",
    "We will reply with our UPI / IMPS transaction reference (UTR) once paid."
  ];

  return `mailto:${BILLING_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}

// MapLibre setup centered on India
const mapEl = document.getElementById("partner-map");
let map: Map | null = null;
let marker: Marker | null = null;

function setPin(lat: number, lng: number) {
  point = { lat, lng };
  if (pinLabel) {
    pinLabel.textContent = `Pinned: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  if (map) {
    if (!marker) {
      marker = new Marker({ color: "#b45309", draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      marker.on("dragend", () => {
        const ll = marker?.getLngLat();
        if (ll) setPin(ll.lat, ll.lng);
      });
    } else {
      marker.setLngLat([lng, lat]);
    }
  }
}

if (mapEl) {
  map = new Map({
    container: mapEl,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [78.9629, 20.5937],
    zoom: 4.3
  });
  map.addControl(new NavigationControl(), "top-right");
  map.on("click", (e) => {
    setPin(e.lngLat.lat, e.lngLat.lng);
  });
}

document.getElementById("locate-me")?.addEventListener("click", () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    setPin(latitude, longitude);
    map?.flyTo({ center: [longitude, latitude], zoom: 15 });
  });
});

for (const btn of document.querySelectorAll<HTMLButtonElement>(".city-jump")) {
  btn.addEventListener("click", () => {
    const lat = Number(btn.dataset.lat);
    const lng = Number(btn.dataset.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map?.flyTo({ center: [lng, lat], zoom: 12 });
    }
  });
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!point) {
    setStatus("Please click the map to pin your shop location first.", "error");
    return;
  }
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  const offer = String(fd.get("offer") || "").trim();
  const address = String(fd.get("address") || "").trim();
  const phone = String(fd.get("phone") || "").trim();
  if (!name || !offer || !address || !phone) {
    setStatus("Please fill in shop name, one line offer, address, and phone.", "error");
    return;
  }

  setStatus("Sending placement request…", "idle");
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT_ID
      },
      body: JSON.stringify({
        body: JSON.stringify({
          action: "partnerPlace",
          name,
          offer,
          category: String(fd.get("category") || "").trim(),
          address,
          phone,
          email: String(fd.get("email") || "").trim(),
          link: String(fd.get("link") || "").trim(),
          referralCode: String(fd.get("referralCode") || "").trim().toLowerCase(),
          lat: point.lat,
          lng: point.lng,
          days,
          locale: "en-IN",
          currency: "INR"
        }),
        method: "POST",
        path: "/"
      })
    }).catch(() => null);
  } finally {
    window.location.href = buildMailtoHref();
    setStatus("Opening your email client with UPI / IMPS payment details.", "ok");
  }
});

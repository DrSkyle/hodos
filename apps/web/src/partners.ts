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
import { wireThemeToggle } from "./theme";

// Same self-hosted worker as the live map, so Vite's asset hashing cannot
// break the placement map.
setWorkerUrl("/maplibre-gl-worker.js");
wireThemeToggle("theme-toggle");

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

function buildMailtoHref(): string {
  const data = form ? new FormData(form) : null;
  const shopName = String(data?.get("name") || "").trim();
  const offer = String(data?.get("offer") || "").trim();
  const category = String(data?.get("category") || "").trim();
  const address = String(data?.get("address") || "").trim();
  const phone = String(data?.get("phone") || "").trim();
  const spanLabel = days === 365 ? "1 year" : `${days} day${days === 1 ? "" : "s"}`;
  const coordsLine = point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "(not pinned on map yet)";

  const subject = shopName
    ? `Hodos shop pin — ${shopName}`
    : "Hodos shop pin — free setup";

  const bodyLines = [
    "Hi Hodos team,",
    "",
    "Please help us place our free initial shop pin on the Hodos map.",
    "",
    `Shop name: ${shopName || ""}`,
    `One line / offer: ${offer || ""}`,
    `Category: ${category || ""}`,
    `Address: ${address || ""}`,
    `Phone: ${phone || ""}`,
    `Duration: ${spanLabel} (Free initially)`,
    `Map location: ${coordsLine}`
  ];

  return `mailto:${BILLING_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}

function syncMailtoLinks() {
  const href = buildMailtoHref();
  const helpLink = document.querySelector<HTMLAnchorElement>("#payment-help a");
  if (helpLink) helpLink.href = href;
  const setupLink = document.getElementById("email-setup-link") as HTMLAnchorElement | null;
  if (setupLink) setupLink.href = href;
}

function renderQuote() {
  if (!priceHost) return;
  if (!quote) {
    priceHost.textContent = "…";
    return;
  }
  const isFreeLaunch = true;
  if (isFreeLaunch) {
    priceHost.textContent = "Free initially";
    if (priceNote) {
      priceNote.textContent = "Shop pins are completely free initially everywhere — no payment or card needed.";
    }
  } else {
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
  }

  const refLabel = document.getElementById("payment-reference-label");
  const refInput = document.getElementById("payment-reference-input") as HTMLInputElement | null;
  const refHelp = document.getElementById("payment-help");
  const refCodeInput = document.getElementById("referral-code-input") as HTMLInputElement | null;
  const submitBtn = document.getElementById("placement-submit-btn") as HTMLButtonElement | null;
  const mailHref = buildMailtoHref();
  if (isFreeLaunch) {
    if (refInput) {
      refInput.required = false;
      const field = refInput.closest(".field") as HTMLElement | null;
      if (field) field.hidden = true;
    }
    if (refCodeInput) {
      const field = refCodeInput.closest(".field") as HTMLElement | null;
      if (field) field.hidden = true;
    }
    if (submitBtn) submitBtn.textContent = "Put my free pin on the map";
  } else {
    if (refLabel) refLabel.textContent = "Payment reference";
    if (refInput) {
      refInput.placeholder = "UPI / IMPS / Card / Payoneer reference";
      refInput.required = true;
      const field = refInput.closest(".field") as HTMLElement | null;
      if (field) field.hidden = false;
    }
    if (refCodeInput) {
      const field = refCodeInput.closest(".field") as HTMLElement | null;
      if (field) field.hidden = false;
    }
    if (refHelp) {
      refHelp.innerHTML = `Email <a href="${mailHref}">${BILLING_EMAIL}</a> for setup help.`;
    }
    if (submitBtn) submitBtn.textContent = "Put my pin on the map";
  }
  const setupLink = document.getElementById("email-setup-link") as HTMLAnchorElement | null;
  if (setupLink) setupLink.href = mailHref;

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
    if (priceHost) priceHost.textContent = "Free initially";
    if (priceNote) priceNote.textContent = "Shop pins are completely free initially everywhere — no payment or card needed.";
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
  const loc = browserLocale();
  const isNp = /^ne/i.test(loc);
  const isIn = /[-_]IN$/i.test(loc);
  const initialCenter: [number, number] = isNp
    ? [85.324, 27.7172]
    : isIn
    ? [78.9629, 20.5937]
    : [85.324, 27.7172];
  const initialZoom = isNp ? 11.5 : isIn ? 4.5 : 6.5;

  const map = new Map({
    container: host,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 18,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
        }
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }]
    },
    center: initialCenter,
    zoom: initialZoom,
    minZoom: 1.5,
    maxZoom: 21,
    renderWorldCopies: false,
    attributionControl: { compact: true }
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");

  let marker: Marker | null = null;
  const addressInput = form?.querySelector<HTMLInputElement>('input[name="address"]') ?? null;

  const dropPin = (lat: number, lng: number, flyZoom?: number, autoAddress?: string) => {
    point = { lat, lng };
    if (!marker) {
      marker = new Marker({ color: "#d97706", draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker?.getLngLat();
        if (pos) dropPin(pos.lat, pos.lng);
      });
    } else {
      marker.setLngLat([lng, lat]);
    }
    if (flyZoom) {
      map.flyTo({ center: [lng, lat], zoom: flyZoom, duration: 750 });
    }
    if (pinLabel) {
      pinLabel.textContent = `Pinned: ${lat.toFixed(5)}, ${lng.toFixed(5)} (drag pin to adjust)`;
      pinLabel.dataset.tone = "ok";
    }
    if (autoAddress && addressInput && !addressInput.value.trim()) {
      addressInput.value = autoAddress.slice(0, 160);
    }
  };

  map.on("click", (event) => {
    dropPin(event.lngLat.lat, event.lngLat.lng);
  });

  // City quick-jumps
  document.querySelectorAll<HTMLButtonElement>(".city-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lat = Number(btn.dataset.lat);
      const lng = Number(btn.dataset.lng);
      const z = Number(btn.dataset.z) || 13;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        dropPin(lat, lng, z);
      }
    });
  });

  // Place & coordinate search (OpenStreetMap Nominatim + raw "lat, lng")
  const searchInput = document.getElementById("pin-search-input") as HTMLInputElement | null;
  const searchBtn = document.getElementById("pin-search-btn") as HTMLButtonElement | null;
  const resultsHost = document.getElementById("pin-search-results") as HTMLElement | null;

  const runSearch = async () => {
    const q = (searchInput?.value || "").trim();
    if (!q || !resultsHost) return;

    // 1. Direct coordinates: e.g. "27.7172, 85.3240"
    const coordMatch = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(q);
    if (coordMatch) {
      const lat = Number(coordMatch[1]);
      const lng = Number(coordMatch[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        resultsHost.hidden = true;
        dropPin(lat, lng, 16);
        return;
      }
    }

    resultsHost.hidden = false;
    resultsHost.innerHTML = `<div class="map-search-item"><small>Searching "${q.replace(/[<>&]/g, "")}"…</small></div>`;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } }
      );
      const items = (await res.json()) as Array<{ display_name: string; name?: string; lat: string; lon: string }>;
      if (!Array.isArray(items) || items.length === 0) {
        resultsHost.innerHTML = `<div class="map-search-item"><small>No places found — try a nearby road, landmark or city name.</small></div>`;
        return;
      }
      resultsHost.innerHTML = "";
      for (const item of items) {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-search-item";
        const parts = item.display_name.split(",");
        const titleText = (item.name || parts[0] || "Location").trim();
        const subText = parts.slice(1, 4).join(",").trim();
        const strong = document.createElement("strong");
        strong.textContent = titleText;
        const small = document.createElement("small");
        small.textContent = subText || item.display_name;
        btn.append(strong, small);
        btn.addEventListener("click", () => {
          resultsHost.hidden = true;
          if (searchInput) searchInput.value = titleText;
          dropPin(lat, lng, 16, [titleText, subText].filter(Boolean).join(", "));
        });
        resultsHost.append(btn);
      }
    } catch (_) {
      resultsHost.innerHTML = `<div class="map-search-item"><small>Search unavailable right now — tap the map or use your location.</small></div>`;
    }
  };

  searchBtn?.addEventListener("click", () => void runSearch());
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  });
  document.addEventListener("click", (e) => {
    if (resultsHost && !resultsHost.hidden && !resultsHost.parentElement?.contains(e.target as Node)) {
      resultsHost.hidden = true;
    }
  });

  const locate = document.getElementById("use-my-location");
  locate?.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setStatus("This browser has no location support — search or tap the map instead.", "error");
      return;
    }
    setStatus("Finding your shop…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        dropPin(latitude, longitude, 16);
        setStatus("Pin placed at your location. Drag the pin or tap the map to fine-tune.");
      },
      () => setStatus("Couldn't read your location — search your area above or tap the map.", "error"),
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
  manageKey?: string;
  amount: string;
  days: number;
  next: string;
  lat?: number;
  lng?: number;
}) {
  const host = document.getElementById("placement-result");
  if (!host) return;
  const until = order.activeUntil ? new Date(order.activeUntil) : null;
  const untilText = until
    ? until.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );

  const mapHref =
    order.placement && Number.isFinite(order.lat) && Number.isFinite(order.lng)
      ? `/map/?shop=${encodeURIComponent(order.placement)}#16/${Number(order.lat).toFixed(5)}/${Number(order.lng).toFixed(5)}`
      : "/map/";

  const manageHref =
    order.placement && order.manageKey
      ? `/partners/manage/#id=${encodeURIComponent(order.placement)}&key=${encodeURIComponent(order.manageKey)}`
      : "/partners/manage/";

  host.innerHTML = `
    <div class="result-card${order.live ? " is-live" : ""}">
      <span class="result-tag">${order.live ? "Live now · Free pin" : "Pending"}</span>
      <strong class="result-title">${order.live ? "Your pin is on the map" : "Your pin could not be published yet"}</strong>
      <p class="result-copy">${
        order.live
          ? `Visible to riders and AI assistants until ${esc(untilText)}. Initial shop pins are completely free with 0% commission — it comes down on its own when the days run out.`
          : esc(order.next || "Please check your shop details and try again.")
      }</p>
      ${
        order.placement
          ? `<div class="result-pin-box">
              <div class="result-pin-meta">
                <span class="result-pin-label">1. Your Pin Reference ID · Save this</span>
                <code class="result-pin-id" id="result-pin-code">${esc(order.placement)}</code>
              </div>
              ${
                order.manageKey
                  ? `<div class="result-pin-meta">
                      <span class="result-pin-label">2. Private Owner Secret Key · Shown once</span>
                      <code class="result-pin-id result-secret-code" id="result-owner-key" data-revealed="false">••••••••••••••••••••••••</code>
                      <span class="result-pin-hint">Keep this secret safe. Only someone with your Pin ID + Owner Key can edit your live offers, view rider stats, or request more days.</span>
                    </div>`
                  : `<span class="result-pin-hint">Use this ID anytime to check how many riders passed your shop.</span>`
              }
              <div class="result-pin-btns">
                <button class="result-btn result-btn-accent" type="button" id="copy-pin-id">Copy Pin ID</button>
                ${
                  order.manageKey
                    ? `<button class="result-btn result-btn-primary" type="button" id="copy-owner-key">Copy Owner Key</button>
                       <button class="result-btn result-btn-ghost" type="button" id="reveal-owner-key">Reveal key</button>`
                    : `<button class="result-btn result-btn-ghost" type="button" id="track-pin-id">Check stats</button>`
                }
              </div>
            </div>`
          : ""
      }
      <div class="result-actions">
        ${
          order.manageKey
            ? `<a class="result-btn result-btn-accent" href="${esc(manageHref)}">Open my Shop Dashboard →</a>`
            : ""
        }
        <a class="result-btn result-btn-primary" href="${esc(mapHref)}">See it on the map</a>
        <button class="result-btn result-btn-ghost" type="button" id="place-another-pin">Place another pin</button>
      </div>
    </div>
  `;
  host.hidden = false;
  host.scrollIntoView({ behavior: "smooth", block: "center" });

  const copyBtn = host.querySelector<HTMLButtonElement>("#copy-pin-id");
  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(order.placement);
      copyBtn.textContent = "Pin ID copied ✓";
      window.setTimeout(() => {
        copyBtn.textContent = "Copy Pin ID";
      }, 2200);
    } catch {
      copyBtn.textContent = order.placement;
    }
  });

  const copyKeyBtn = host.querySelector<HTMLButtonElement>("#copy-owner-key");
  copyKeyBtn?.addEventListener("click", async () => {
    if (!order.manageKey) return;
    try {
      await navigator.clipboard.writeText(order.manageKey);
      copyKeyBtn.textContent = "Owner Key copied ✓";
      window.setTimeout(() => {
        copyKeyBtn.textContent = "Copy Owner Key";
      }, 2200);
    } catch {
      const el = host.querySelector<HTMLElement>("#result-owner-key");
      if (el) {
        el.textContent = order.manageKey;
        el.dataset.revealed = "true";
      }
      copyKeyBtn.textContent = "Revealed above — copy it";
    }
  });

  const revealKeyBtn = host.querySelector<HTMLButtonElement>("#reveal-owner-key");
  revealKeyBtn?.addEventListener("click", () => {
    const el = host.querySelector<HTMLElement>("#result-owner-key");
    if (!el || !order.manageKey) return;
    const isShown = el.dataset.revealed === "true";
    el.textContent = isShown ? "••••••••••••••••••••••••" : order.manageKey;
    el.dataset.revealed = isShown ? "false" : "true";
    revealKeyBtn.textContent = isShown ? "Reveal key" : "Hide key";
  });

  host.querySelector<HTMLButtonElement>("#track-pin-id")?.addEventListener("click", () => {
    const lookupInput = document.getElementById("lookup-placement-id") as HTMLInputElement | null;
    const lookupForm = document.getElementById("lookup-placement-form") as HTMLFormElement | null;
    if (lookupInput && lookupForm) {
      lookupInput.value = order.placement;
      lookupForm.scrollIntoView({ behavior: "smooth", block: "center" });
      lookupForm.requestSubmit();
    }
  });

  host.querySelector<HTMLButtonElement>("#place-another-pin")?.addEventListener("click", () => {
    host.hidden = true;
    setStatus("");
    form?.scrollIntoView({ behavior: "smooth", block: "start" });
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

function wireLookup() {
  const lookupForm = document.getElementById("lookup-placement-form") as HTMLFormElement | null;
  const lookupInput = document.getElementById("lookup-placement-id") as HTMLInputElement | null;
  const lookupStatus = document.getElementById("lookup-placement-status") as HTMLElement | null;
  const lookupResult = document.getElementById("lookup-placement-result") as HTMLElement | null;
  if (!lookupForm || !lookupInput || !lookupStatus || !lookupResult) return;

  const runLookup = async (placementId: string) => {
    const clean = placementId.trim();
    if (!clean) return;
    lookupStatus.textContent = "Checking placement…";
    lookupStatus.dataset.tone = "idle";
    try {
      const res = await callApi({ action: "partnerStatus", placement: clean });
      if (!res.ok) {
        lookupResult.hidden = true;
        lookupStatus.textContent = res.error || "Could not find that placement ID.";
        lookupStatus.dataset.tone = "error";
        return;
      }
      lookupStatus.textContent = "";
      const until = res.activeUntil ? new Date(String(res.activeUntil)) : null;
      const untilText = until && !Number.isNaN(until.getTime())
        ? until.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "";
      const passes = Number(res.passesThisMonth) || 0;
      const esc = (s: unknown) =>
        String(s ?? "").replace(/[&<>"']/g, (c) =>
          c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
        );

      lookupResult.innerHTML = `
        <div class="result-card${res.live ? " is-live" : ""}">
          <span class="result-tag">${res.live ? "Live on the map" : esc(res.status || "Not live")}</span>
          <strong class="result-title">${esc(res.name || "Your shop")} · ${esc(res.category || "Shop")}</strong>
          <p class="result-copy">${
            res.live
              ? `Visible to riders and AI assistants until ${esc(untilText)}.`
              : "This placement is not currently live on the map."
          }</p>
          <p class="result-metric">
            ${passes} distinct device${passes === 1 ? "" : "s"} passed your shop in ${esc(res.month || "this month")}
          </p>
          <p class="result-ref">Pin ID: <code>${esc(res.placement)}</code></p>
        </div>
      `;
      lookupResult.hidden = false;
    } catch (_) {
      lookupResult.hidden = true;
      lookupStatus.textContent = "Could not check that placement right now.";
      lookupStatus.dataset.tone = "error";
    }
  };

  lookupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runLookup(lookupInput.value);
  });

  try {
    const id = new URLSearchParams(window.location.search).get("placement") || "";
    if (id.trim()) {
      lookupInput.value = id.trim();
      void runLookup(id.trim());
    }
  } catch (_) {
    // ignore
  }
}

function wireForm() {
  if (!form) return;
  form.addEventListener("input", syncMailtoLinks);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const offer = String(data.get("offer") || "").trim();
    const address = String(data.get("address") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const email = String(data.get("email") || "").trim();
    const rawReference = String(data.get("reference") || "").trim();
    const reference = rawReference.length >= 4 ? rawReference : "FREE-GLOBAL-LAUNCH";

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
      const placedLat = point.lat;
      const placedLng = point.lng;
      form.reset();
      setStatus("");
      showResult({
        live: Boolean(result.live),
        activeUntil: result.activeUntil as string | null,
        placement: String(result.placement || ""),
        manageKey: typeof result.manageKey === "string" ? result.manageKey : undefined,
        amount: money(result.totalLocal, result.currency),
        days: Number(result.days) || days,
        next: String(result.next || ""),
        lat: placedLat,
        lng: placedLng
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
wireLookup();
void refreshQuote();

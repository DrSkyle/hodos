import "./cartographic.css";
import "./partners.css";
import "./partner-manage.css";
import "./pwa";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker } from "maplibre-gl";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

const API_URL = "https://sgp.cloud.appwrite.io/v1/functions/hodos-api/executions";
const PROJECT = "6ad7939a002ff135e419";
const STORAGE_KEY = "hodos.shop.portal.v1";

interface PortalData {
  ok: boolean;
  error?: string;
  placement: string;
  name: string;
  category: string;
  offer: string;
  link: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  live: boolean;
  status: string;
  activeUntil: string | null;
  days: number;
  daysRemaining: number;
  month: string;
  passesThisMonth: number;
  monthlyPasses: Array<{ month: string; passes: number }>;
  nearbyHazardsCount: number;
  pendingExtension: { days: number; requestedAt: string } | null;
  apiDiscovery?: { enabled: boolean; endpoints: string[] };
}

type ViewId = "overview" | "creative" | "analytics" | "plan" | "security";

const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
  overview: {
    title: "Overview",
    subtitle: "Live performance, road context, and visibility for your shop pin."
  },
  creative: {
    title: "Live Offer & Preview",
    subtitle: "Edit your offer and see exactly what riders and AI assistants receive."
  },
  analytics: {
    title: "Rider Traffic & Roads",
    subtitle: "Anonymous monthly device pass history and nearby road-condition intelligence."
  },
  plan: {
    title: "Plan & Extra Days",
    subtitle: "Track active duration and request additional days directly from Hodos."
  },
  security: {
    title: "Keys & Backup",
    subtitle: "Download a local backup of your Pin Reference ID and Owner Secret Key."
  }
};

async function callApi(payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": PROJECT
    },
    body: JSON.stringify({ body: JSON.stringify(payload) })
  });
  const outer = await response.json();
  return JSON.parse(outer.responseBody || "{}");
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

function categoryMeta(raw: string): { label: string; color: string } {
  const c = (raw || "").toLowerCase();
  if (/tyre|tire|garage|mechanic|auto|car|moto|bike|wash|tow|workshop|repair|service|parts/.test(c)) {
    return { label: "Auto & Tyre", color: "#27272a" };
  }
  if (/ev|charg|fuel|petrol|gas|battery/.test(c)) return { label: "EV & Fuel", color: "#0f766e" };
  if (/pharm|med|clinic|hospital|health|first/.test(c)) return { label: "Pharmacy", color: "#9d174d" };
  if (/cafe|coffee|tea|food|restaurant|biryani|bakery|snack|dhaba|eat|dining/.test(c)) {
    return { label: "Food & Café", color: "#6b4423" };
  }
  return { label: "Local stop", color: "#3f3f46" };
}

function downloadCredentialsFile(data: PortalData, manageKey: string) {
  const slug = (data.name || "shop")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28) || "shop";
  const mapUrl = Number.isFinite(data.lat) && Number.isFinite(data.lng)
    ? `https://hodos.devilabs.dev/map/?shop=${encodeURIComponent(data.placement)}#16/${data.lat.toFixed(5)}/${data.lng.toFixed(5)}`
    : "https://hodos.devilabs.dev/map/";
  const lines = [
    "================================================================",
    "HODOS PRIVATE SHOP CREDENTIALS — KEEP THIS FILE SAFE & PRIVATE",
    "================================================================",
    "",
    `Shop Name:        ${data.name}`,
    `Category:         ${data.category}`,
    `Live Offer:       ${data.offer}`,
    `Address:          ${data.address || "—"}`,
    `Phone:            ${data.phone || "—"}`,
    `Coordinates:      ${Number.isFinite(data.lat) ? `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}` : "—"}`,
    `Active Until:     ${data.activeUntil || "—"}`,
    "",
    "--- PRIVATE ACCESS CREDENTIALS ---",
    `Pin Reference ID: ${data.placement}`,
    `Owner Secret Key: ${manageKey}`,
    "",
    "--- DIRECT LINKS ---",
    "Partner Console:  https://hodos.devilabs.dev/partners/manage/",
    `Your Live Pin:    ${mapUrl}`,
    "",
    "SECURITY NOTE:",
    "Hodos does not store your raw Owner Secret Key (only its SHA-256 hash).",
    "Anyone with both your Pin Reference ID and Owner Secret Key can edit",
    "your live shop offer and request extensions. Do not post this file publicly.",
    ""
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hodos-shop-key-${slug}-${data.placement}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function renderPassChart(host: HTMLElement | null, items: Array<{ month: string; passes: number }>) {
  if (!host) return;
  const rows = items.length ? items : [{ month: new Date().toISOString().slice(0, 7), passes: 0 }];
  const w = 520;
  const h = 210;
  const padL = 34;
  const padR = 16;
  const padT = 18;
  const padB = 34;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxVal = Math.max(4, ...rows.map((r) => r.passes));
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : innerW / 2;

  const points = rows.map((r, i) => {
    const x = rows.length > 1 ? padL + i * stepX : padL + innerW / 2;
    const y = padT + innerH - (r.passes / maxVal) * innerH;
    return { ...r, x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${(padT + innerH).toFixed(1)} L${points[0]!.x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`
      : "";

  const gridLines = [0, 0.5, 1].map((frac) => {
    const y = padT + innerH - frac * innerH;
    const val = Math.round(maxVal * frac);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 4" />
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="ui-monospace,monospace">${val}</text>
    `;
  }).join("");

  const barsAndDots = points
    .map((p) => {
      const barW = Math.min(34, Math.max(18, innerW / Math.max(rows.length * 1.8, 3)));
      const barH = Math.max(4, padT + innerH - p.y);
      return `
        <rect x="${(p.x - barW / 2).toFixed(1)}" y="${p.y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="6" fill="var(--accent)" opacity="0.18" />
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="var(--accent)" stroke="var(--paper-raised)" stroke-width="2.5" />
        <text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" fill="var(--ink)" font-size="11.5" font-weight="700">${p.passes}</text>
        <text x="${p.x.toFixed(1)}" y="${h - 10}" text-anchor="middle" fill="var(--muted)" font-size="11" font-family="ui-monospace,monospace">${esc(p.month.slice(2))}</text>
      `;
    })
    .join("");

  host.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Monthly rider pass trend">
      ${gridLines}
      ${areaPath ? `<path d="${areaPath}" fill="var(--accent)" opacity="0.08" />` : ""}
      ${points.length > 1 ? `<path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${barsAndDots}
    </svg>
  `;
}

const lockSection = document.getElementById("portal-lock-section") as HTMLElement | null;
const dashSection = document.getElementById("portal-dashboard") as HTMLElement | null;
const unlockForm = document.getElementById("portal-unlock-form") as HTMLFormElement | null;
const pinInput = document.getElementById("portal-pin-id") as HTMLInputElement | null;
const keyInput = document.getElementById("portal-manage-key") as HTMLInputElement | null;
const rememberBox = document.getElementById("portal-remember-box") as HTMLInputElement | null;
const unlockStatus = document.getElementById("portal-unlock-status") as HTMLElement | null;
const toggleKeyBtn = document.getElementById("toggle-key-visibility") as HTMLButtonElement | null;

const updateForm = document.getElementById("portal-update-form") as HTMLFormElement | null;
const updateStatus = document.getElementById("portal-update-status") as HTMLElement | null;
const extendForm = document.getElementById("portal-extend-form") as HTMLFormElement | null;
const extendStatus = document.getElementById("portal-extend-status") as HTMLElement | null;
const extendBtn = document.getElementById("portal-extend-btn") as HTMLButtonElement | null;

let activeCreds: { placement: string; manageKey: string } | null = null;
let currentData: PortalData | null = null;
let miniMap: MapLibreMap | null = null;
let requestedDays = 30;
let isFreshRedirect = false;

function setToneStatus(el: HTMLElement | null, text: string, tone: "idle" | "ok" | "error" = "idle") {
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function showView(view: ViewId) {
  document.querySelectorAll<HTMLButtonElement>(".console-nav-btn").forEach((btn) => {
    const active = btn.dataset.view === view;
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLElement>("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  const titleEl = document.getElementById("topbar-title");
  const subEl = document.getElementById("topbar-subtitle");
  if (titleEl) titleEl.textContent = VIEW_META[view].title;
  if (subEl) subEl.textContent = VIEW_META[view].subtitle;
  if (view === "overview" && miniMap) {
    window.setTimeout(() => miniMap?.resize(), 60);
  }
}

document.querySelectorAll<HTMLButtonElement>(".console-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view as ViewId | undefined;
    if (v && v in VIEW_META) showView(v);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-jump-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.jumpView as ViewId | undefined;
    if (v && v in VIEW_META) showView(v);
  });
});

toggleKeyBtn?.addEventListener("click", () => {
  if (!keyInput) return;
  const showing = keyInput.type === "text";
  keyInput.type = showing ? "password" : "text";
  toggleKeyBtn.textContent = showing ? "Show" : "Hide";
});

function syncLivePreview() {
  if (!currentData) return;
  const offer = (document.getElementById("edit-offer") as HTMLInputElement | null)?.value.trim() || currentData.offer;
  const category = (document.getElementById("edit-category") as HTMLSelectElement | null)?.value || currentData.category;
  const link = (document.getElementById("edit-link") as HTMLInputElement | null)?.value.trim() || "";
  const cat = categoryMeta(category);

  const prevCat = document.getElementById("prev-cat");
  const prevName = document.getElementById("prev-name");
  const prevOffer = document.getElementById("prev-offer");
  const prevLinkPill = document.getElementById("prev-link-pill");
  const prevJson = document.getElementById("prev-agent-json");

  if (prevCat) {
    prevCat.textContent = cat.label;
    prevCat.style.background = cat.color;
  }
  if (prevName) prevName.textContent = currentData.name;
  if (prevOffer) prevOffer.textContent = offer || "Add your live offer line…";
  if (prevLinkPill) prevLinkPill.hidden = !link;
  if (prevJson) {
    prevJson.textContent = JSON.stringify(
      {
        id: currentData.placement,
        name: currentData.name,
        category,
        offer,
        lat: Number(currentData.lat.toFixed(5)),
        lng: Number(currentData.lng.toFixed(5)),
        link: link || null,
        activeUntil: currentData.activeUntil
      },
      null,
      2
    );
  }
}

function mountMiniMap(data: PortalData) {
  const host = document.getElementById("console-minimap");
  if (!host || !Number.isFinite(data.lat) || !Number.isFinite(data.lng)) return;
  if (miniMap) {
    miniMap.remove();
    miniMap = null;
  }
  miniMap = new MapLibreMap({
    container: host,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 18
        }
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }]
    },
    center: [data.lng, data.lat],
    zoom: 15.2,
    attributionControl: false
  });
  new Marker({ color: "#be185d" }).setLngLat([data.lng, data.lat]).addTo(miniMap);
}

function renderDashboard(data: PortalData) {
  currentData = data;
  if (lockSection) lockSection.hidden = true;
  if (dashSection) dashSection.hidden = false;

  const freshBanner = document.getElementById("console-fresh-banner");
  if (freshBanner) freshBanner.hidden = !isFreshRedirect;

  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const liveDot = document.getElementById("side-live-dot");
  if (liveDot) liveDot.classList.toggle("is-off", !data.live);
  set("side-live-label", data.live ? "Live on map" : "Expired");
  set("side-shop-name", data.name || "Your shop");
  set("side-pin-id", data.placement);

  const until = data.activeUntil ? new Date(data.activeUntil) : null;
  const untilText = until && !Number.isNaN(until.getTime())
    ? until.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Not active";

  const mapHref =
    Number.isFinite(data.lat) && Number.isFinite(data.lng)
      ? `/map/?shop=${encodeURIComponent(data.placement)}#16/${data.lat.toFixed(5)}/${data.lng.toFixed(5)}`
      : "/map/";

  for (const linkId of ["side-map-link", "banner-map-link", "overview-map-link"]) {
    const a = document.getElementById(linkId) as HTMLAnchorElement | null;
    if (a) a.href = mapHref;
  }

  set("kpi-month-pill", data.month || "This month");
  set("kpi-status-pill", data.live ? "Live" : "Expired");
  set("dash-passes-month", String(data.passesThisMonth || 0));
  set("dash-days-left", String(data.daysRemaining || 0));
  set("dash-expiry-line", data.live ? `Until ${untilText}` : "Request extra days to reactivate");
  const pctLeft = Math.max(4, Math.min(100, Math.round(((data.daysRemaining || 0) / Math.max(1, data.days || 1)) * 100)));
  const bar = document.getElementById("dash-days-bar");
  if (bar) bar.style.width = `${data.live ? pctLeft : 0}%`;

  set("dash-nearby-hazards", String(data.nearbyHazardsCount || 0));
  set(
    "dash-hazards-tip",
    data.nearbyHazardsCount > 0
      ? "Rough roads nearby — drivers slow down here."
      : "Smooth stretch reported so far."
  );
  set("dash-api-status", data.live ? "Active" : "Paused");
  set(
    "overview-address-line",
    data.address
      ? `${data.address} · ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`
      : `${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`
  );

  renderPassChart(document.getElementById("overview-chart"), data.monthlyPasses || []);
  mountMiniMap(data);

  // Analytics table
  const tbody = document.getElementById("analytics-table-body");
  if (tbody) {
    tbody.innerHTML = (data.monthlyPasses || [])
      .slice()
      .reverse()
      .map((m) => `<tr><td><code>${esc(m.month)}</code></td><td><strong>${m.passes}</strong></td></tr>`)
      .join("");
  }
  set("analytics-hazards-val", `${data.nearbyHazardsCount || 0} active defects`);
  set("analytics-tier-pill", categoryMeta(data.category).label);

  // Plan tab
  set("plan-expiry-val", untilText);
  set("plan-days-val", `${data.daysRemaining || 0} of ${data.days || 1} days`);

  // Security tab
  set("sec-pin-id", data.placement);
  const secKeyEl = document.getElementById("sec-owner-key");
  if (secKeyEl) {
    secKeyEl.textContent = "••••••••••••••••••••••••••••••••";
    secKeyEl.dataset.revealed = "false";
  }

  // Creative form
  const editOffer = document.getElementById("edit-offer") as HTMLInputElement | null;
  const editCategory = document.getElementById("edit-category") as HTMLSelectElement | null;
  const editPhone = document.getElementById("edit-phone") as HTMLInputElement | null;
  const editLink = document.getElementById("edit-link") as HTMLInputElement | null;
  if (editOffer) editOffer.value = data.offer || "";
  if (editCategory) {
    const exists = Array.from(editCategory.options).some((o) => o.value === data.category);
    editCategory.value = exists ? data.category : "business";
  }
  if (editPhone) editPhone.value = data.phone || "";
  if (editLink) editLink.value = data.link || "";
  syncLivePreview();

  const pendingEl = document.getElementById("dash-pending-ext");
  if (pendingEl) {
    if (data.pendingExtension) {
      pendingEl.hidden = false;
      pendingEl.textContent = `Latest request: +${data.pendingExtension.days} days (recorded ${data.pendingExtension.requestedAt}).`;
    } else {
      pendingEl.hidden = true;
    }
  }
}

for (const id of ["edit-offer", "edit-category", "edit-link"]) {
  document.getElementById(id)?.addEventListener("input", syncLivePreview);
  document.getElementById(id)?.addEventListener("change", syncLivePreview);
}

async function unlockPortal(placement: string, manageKey: string, saveLocally: boolean) {
  const cleanId = placement.trim();
  const cleanKey = manageKey.trim();
  if (!cleanId || cleanKey.length < 16) {
    setToneStatus(unlockStatus, "Enter both your Pin Reference ID and Owner Secret Key (hsk_...).", "error");
    return;
  }
  setToneStatus(unlockStatus, "Verifying owner key…", "idle");
  try {
    const res = (await callApi({
      action: "partnerPortal",
      placement: cleanId,
      manageKey: cleanKey
    })) as PortalData;
    if (!res.ok) {
      setToneStatus(unlockStatus, res.error || "Could not unlock this shop console.", "error");
      return;
    }
    activeCreds = { placement: cleanId, manageKey: cleanKey };
    if (saveLocally) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activeCreds));
      } catch {
        // ignore storage errors
      }
    }
    setToneStatus(unlockStatus, "");
    renderDashboard(res);
    showView("overview");
  } catch {
    setToneStatus(unlockStatus, "Could not reach Hodos right now. Check your connection and try again.", "error");
  }
}

unlockForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void unlockPortal(pinInput?.value || "", keyInput?.value || "", Boolean(rememberBox?.checked));
});

function lockConsole() {
  activeCreds = null;
  currentData = null;
  isFreshRedirect = false;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (keyInput) keyInput.value = "";
  if (dashSection) dashSection.hidden = true;
  if (lockSection) lockSection.hidden = false;
  setToneStatus(unlockStatus, "Console locked. Enter your Pin ID and Owner Key to open again.", "idle");
}

document.getElementById("portal-lock-btn")?.addEventListener("click", lockConsole);
document.getElementById("sec-lock-btn")?.addEventListener("click", lockConsole);

for (const dlId of ["side-download-key", "banner-download-key", "sec-download-key"]) {
  document.getElementById(dlId)?.addEventListener("click", () => {
    if (currentData && activeCreds) {
      downloadCredentialsFile(currentData, activeCreds.manageKey);
    }
  });
}

document.getElementById("sec-copy-id")?.addEventListener("click", async (e) => {
  if (!activeCreds) return;
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(activeCreds.placement);
    btn.textContent = "Copied ✓";
    window.setTimeout(() => (btn.textContent = "Copy Pin ID"), 2000);
  } catch {
    btn.textContent = activeCreds.placement;
  }
});

document.getElementById("sec-copy-key")?.addEventListener("click", async (e) => {
  if (!activeCreds) return;
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(activeCreds.manageKey);
    btn.textContent = "Copied ✓";
    window.setTimeout(() => (btn.textContent = "Copy Key"), 2000);
  } catch {
    btn.textContent = "Reveal & copy";
  }
});

document.getElementById("sec-reveal-key")?.addEventListener("click", (e) => {
  if (!activeCreds) return;
  const btn = e.currentTarget as HTMLButtonElement;
  const code = document.getElementById("sec-owner-key");
  if (!code) return;
  const shown = code.dataset.revealed === "true";
  code.textContent = shown ? "••••••••••••••••••••••••••••••••" : activeCreds.manageKey;
  code.dataset.revealed = shown ? "false" : "true";
  btn.textContent = shown ? "Reveal" : "Hide";
});

updateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeCreds) return;
  const offer = (document.getElementById("edit-offer") as HTMLInputElement | null)?.value.trim() || "";
  const category = (document.getElementById("edit-category") as HTMLSelectElement | null)?.value || "business";
  const phone = (document.getElementById("edit-phone") as HTMLInputElement | null)?.value.trim() || "";
  const link = (document.getElementById("edit-link") as HTMLInputElement | null)?.value.trim() || "";

  if (offer.length < 8) {
    setToneStatus(updateStatus, "Describe your offer or shop line in at least 8 characters.", "error");
    return;
  }

  const btn = document.getElementById("portal-update-btn") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  setToneStatus(updateStatus, "Publishing live changes…", "idle");

  try {
    const res = await callApi({
      action: "partnerUpdate",
      placement: activeCreds.placement,
      manageKey: activeCreds.manageKey,
      offer,
      category,
      phone,
      link
    });
    if (!res.ok) {
      setToneStatus(updateStatus, res.error || "Could not update shop details.", "error");
      return;
    }
    if (currentData) {
      currentData.offer = offer;
      currentData.category = category;
      currentData.phone = phone;
      currentData.link = link;
    }
    syncLivePreview();
    setToneStatus(updateStatus, "Published! Your updated offer is live on the map, Garage, and AI API.", "ok");
  } catch {
    setToneStatus(updateStatus, "Network error — please try saving again.", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-req-days]").forEach((chip) => {
  chip.addEventListener("click", () => {
    requestedDays = Number(chip.dataset.reqDays) || 30;
    document.querySelectorAll<HTMLButtonElement>("[data-req-days]").forEach((c) => {
      c.setAttribute("aria-selected", String(c === chip));
    });
    if (extendBtn) extendBtn.textContent = `Request +${requestedDays} more days`;
  });
});

extendForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeCreds) return;
  if (extendBtn) extendBtn.disabled = true;
  setToneStatus(extendStatus, "Sending request to Hodos…", "idle");
  try {
    const res = await callApi({
      action: "partnerRequestDays",
      placement: activeCreds.placement,
      manageKey: activeCreds.manageKey,
      days: requestedDays
    });
    if (!res.ok) {
      setToneStatus(extendStatus, res.error || "Could not submit extension request.", "error");
      return;
    }
    setToneStatus(extendStatus, res.message || `Requested +${requestedDays} more days.`, "ok");
    const pendingEl = document.getElementById("dash-pending-ext");
    if (pendingEl) {
      pendingEl.hidden = false;
      pendingEl.textContent = `Latest request: +${res.requestedDays || requestedDays} days (recorded ${res.requestedAt || "today"}).`;
    }
  } catch {
    setToneStatus(extendStatus, "Network error — please try again.", "error");
  } finally {
    if (extendBtn) extendBtn.disabled = false;
  }
});

// Auto-read credentials safely from URL fragment (#id=...&key=...) — never sent
// to servers in logs/Referer — and immediately scrub the fragment from history.
(function initCredentials() {
  try {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      const params = new URLSearchParams(hash);
      const id = (params.get("id") || "").trim();
      const key = (params.get("key") || "").trim();
      isFreshRedirect = params.get("fresh") === "1";
      if (id && key) {
        if (pinInput) pinInput.value = id;
        if (keyInput) keyInput.value = key;
        window.history.replaceState(null, "", window.location.pathname);
        void unlockPortal(id, key, true);
        return;
      }
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { placement?: string; manageKey?: string };
      if (parsed.placement && parsed.manageKey) {
        if (pinInput) pinInput.value = parsed.placement;
        if (keyInput) keyInput.value = parsed.manageKey;
        if (rememberBox) rememberBox.checked = true;
        void unlockPortal(parsed.placement, parsed.manageKey, true);
      }
    }
  } catch {
    // ignore malformed hash or blocked storage
  }
})();

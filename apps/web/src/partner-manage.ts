import "./cartographic.css";
import "./partners.css";
import "./pwa";
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
const lockBtn = document.getElementById("portal-lock-btn") as HTMLButtonElement | null;

let activeCreds: { placement: string; manageKey: string } | null = null;
let requestedDays = 30;

function setToneStatus(el: HTMLElement | null, text: string, tone: "idle" | "ok" | "error" = "idle") {
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

toggleKeyBtn?.addEventListener("click", () => {
  if (!keyInput) return;
  const showing = keyInput.type === "text";
  keyInput.type = showing ? "password" : "text";
  toggleKeyBtn.textContent = showing ? "Show" : "Hide";
});

function renderDashboard(data: PortalData) {
  if (lockSection) lockSection.hidden = true;
  if (dashSection) dashSection.hidden = false;

  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set("dash-live-pill", data.live ? "Live on map" : "Expired / Inactive");
  set("dash-category-pill", data.category || "Local shop");
  set("dash-shop-name", data.name || "Your shop");
  set("dash-pin-id", data.placement);
  set("dash-address-line", data.address ? `Address: ${data.address}` : "");

  const until = data.activeUntil ? new Date(data.activeUntil) : null;
  const untilText = until && !Number.isNaN(until.getTime())
    ? until.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  set(
    "dash-expiry-line",
    data.live && untilText
      ? `Visible to riders and AI assistants until ${untilText}.`
      : "This pin is not currently active on the map. Request extra days below."
  );

  const mapLink = document.getElementById("dash-map-link") as HTMLAnchorElement | null;
  if (mapLink && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
    mapLink.href = `/map/?shop=${encodeURIComponent(data.placement)}#16/${data.lat.toFixed(5)}/${data.lng.toFixed(5)}`;
  }

  set("dash-passes-month", String(data.passesThisMonth || 0));
  set("dash-passes-sub", `Distinct devices in ${data.month || "this month"} · anonymous`);
  set("dash-days-left", String(data.daysRemaining || 0));
  set("dash-nearby-hazards", String(data.nearbyHazardsCount || 0));
  set(
    "dash-hazards-tip",
    data.nearbyHazardsCount > 0
      ? "Rough road reports nearby — highlight repair, check, or stop offers."
      : "Quiet road stretch nearby so far."
  );
  set("dash-api-status", data.live ? "Active" : "Paused");

  const barsHost = document.getElementById("dash-monthly-bars");
  if (barsHost) {
    const items = data.monthlyPasses || [];
    const max = Math.max(1, ...items.map((m) => m.passes));
    barsHost.innerHTML = items
      .map((m) => {
        const pct = Math.max(8, Math.round((m.passes / max) * 100));
        return `
          <div class="portal-bar-row">
            <span class="portal-bar-month">${esc(m.month)}</span>
            <div class="portal-bar-track"><div class="portal-bar-fill" style="width:${pct}%"></div></div>
            <strong class="portal-bar-val">${m.passes}</strong>
          </div>
        `;
      })
      .join("");
  }

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
      setToneStatus(unlockStatus, res.error || "Could not unlock this shop dashboard.", "error");
      return;
    }
    activeCreds = { placement: cleanId, manageKey: cleanKey };
    if (saveLocally) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activeCreds));
      } catch {
        // ignore storage restrictions
      }
    }
    setToneStatus(unlockStatus, "");
    renderDashboard(res);
  } catch {
    setToneStatus(unlockStatus, "Could not reach Hodos right now. Check your connection and try again.", "error");
  }
}

unlockForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void unlockPortal(pinInput?.value || "", keyInput?.value || "", Boolean(rememberBox?.checked));
});

lockBtn?.addEventListener("click", () => {
  activeCreds = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (keyInput) keyInput.value = "";
  if (dashSection) dashSection.hidden = true;
  if (lockSection) lockSection.hidden = false;
  setToneStatus(unlockStatus, "Dashboard locked. Enter your credentials to open again.", "idle");
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
  setToneStatus(updateStatus, "Publishing changes to live map…", "idle");

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
    setToneStatus(updateStatus, "Saved! Your updated offer is live on the map and AI API.", "ok");
    const catPill = document.getElementById("dash-category-pill");
    if (catPill) catPill.textContent = category;
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
  setToneStatus(extendStatus, "Recording your extension request…", "idle");
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
      if (id && key) {
        if (pinInput) pinInput.value = id;
        if (keyInput) keyInput.value = key;
        window.history.replaceState(null, "", window.location.pathname);
        void unlockPortal(id, key, false);
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

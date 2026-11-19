import "./cartographic.css";
import "./map.css";
import "./pwa";
import { wireThemeToggle } from "./theme";
import {
  initWebMap,
  isLiveAlertKind,
  reportLiveAlert,
  type LiveAlertKind,
  type MapInstanceHandle,
  type WebHazard
} from "./web-map";

wireThemeToggle("theme-toggle");

let handle: MapInstanceHandle | null = null;
let activeKind = "all";
const searchInput = document.getElementById("map-search-input") as HTMLInputElement | null;
const feedbackEl = document.getElementById("radar-feedback");
const feedEl = document.getElementById("radar-feed");

function relativeAge(iso?: string): string {
  if (!iso) return "Active now";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "Active now";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

function symbolFor(kind: LiveAlertKind): { glyph: string; cls: string } {
  switch (kind) {
    case "police":
      return { glyph: "P", cls: "sym-police" };
    case "jam":
      return { glyph: "!", cls: "sym-jam" };
    case "roadblock":
      return { glyph: "✕", cls: "sym-roadblock" };
    case "flood":
      return { glyph: "≈", cls: "sym-flood" };
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;")
  );
}

function renderRadarFeed(allHazards: WebHazard[]) {
  if (!feedEl) return;
  const alerts = allHazards
    .filter((h): h is WebHazard & { kind: LiveAlertKind } => isLiveAlertKind(h.kind) && !h.fixed)
    .sort((a, b) => Date.parse(b.lastSeen || "") - Date.parse(a.lastSeen || ""));

  feedEl.innerHTML = "";
  for (const alert of alerts.slice(0, 6)) {
    const sym = symbolFor(alert.kind);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "radar-feed-item";
    btn.innerHTML = `
      <span class="radar-symbol ${sym.cls}" aria-hidden="true">${sym.glyph}</span>
      <span class="radar-feed-meta">
        <strong>${escapeHtml(alert.title)}</strong>
        <span>${escapeHtml(relativeAge(alert.lastSeen))} · ${escapeHtml(alert.locationName)}</span>
      </span>
    `;
    btn.addEventListener("click", () => {
      handle?.flyToHazard(alert.id);
    });
    feedEl.appendChild(btn);
  }
}

handle = initWebMap(
  "full-map",
  "full-map-status",
  (h) => {
    handle = h;
    renderRadarFeed(h.hazards);
  },
  (hazards) => {
    renderRadarFeed(hazards);
  }
);

function applyFilters() {
  handle?.filterByKind(activeKind, searchInput?.value || "");
}

document.querySelectorAll(".filter-chip, .chip[data-kind]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip, .chip[data-kind]").forEach((b) => {
      b.classList.remove("active", "is-active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-pressed", "true");
    activeKind = btn.getAttribute("data-kind") || "all";
    applyFilters();
  });
});

searchInput?.addEventListener("input", () => {
  applyFilters();
});

document.getElementById("btn-fit-all")?.addEventListener("click", () => {
  handle?.fitAllHazards();
});

function resolveReportPosition(): Promise<{ lat: number; lng: number; accuracyM: number; source: "gps" | "map" }> {
  return new Promise((resolve) => {
    const fallback = () => {
      const center = handle?.map.getCenter();
      resolve({
        lat: center ? center.lat : 27.7172,
        lng: center ? center.lng : 85.324,
        accuracyM: 80,
        source: "map"
      });
    };
    if (!("geolocation" in navigator)) {
      fallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy || 25,
          source: "gps"
        });
      },
      () => fallback(),
      { enableHighAccuracy: true, timeout: 4500, maximumAge: 60_000 }
    );
  });
}

const radarButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".radar-btn"));

for (const btn of radarButtons) {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.alert || "";
    if (!isLiveAlertKind(kind)) return;

    radarButtons.forEach((b) => (b.disabled = true));
    if (feedbackEl) feedbackEl.textContent = "Locating and publishing live alert…";

    try {
      const pos = await resolveReportPosition();
      const created = await reportLiveAlert(pos.lat, pos.lng, kind as LiveAlertKind, pos.accuracyM);
      handle?.addOptimisticHazard(created);
      if (feedbackEl) {
        const where = pos.source === "gps" ? "at your GPS location" : "at the map center";
        feedbackEl.textContent = `${created.title} reported ${where}. Added to the live feed.`;
      }
    } catch (err) {
      if (feedbackEl) {
        feedbackEl.textContent =
          err instanceof Error
            ? `Could not send alert: ${err.message}`
            : "Could not send alert right now. Check connection and try again.";
      }
    } finally {
      radarButtons.forEach((b) => (b.disabled = false));
    }
  });
}

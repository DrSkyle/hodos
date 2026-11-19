import "./cartographic.css";
import "./pwa";
import { wireThemeToggle } from "./theme";
import {
  initWebMap,
  isLiveAlertKind,
  reportLiveAlert,
  type LiveAlertKind,
  type MapInstanceHandle
} from "./web-map";

wireThemeToggle("theme-toggle");

let handle: MapInstanceHandle | null = null;
let activeKind = "all";
const searchInput = document.getElementById("map-search-input") as HTMLInputElement | null;
const feedbackEl = document.getElementById("radar-feedback");

handle = initWebMap("full-map", "full-map-status", (h) => {
  handle = h;
});

function applyFilters() {
  handle?.filterByKind(activeKind, searchInput?.value || "");
}

document.querySelectorAll(".filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
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
        feedbackEl.textContent = `${created.title} reported ${where}. Visible to drivers now.`;
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

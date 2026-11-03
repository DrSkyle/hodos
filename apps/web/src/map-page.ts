import "./milestone.css";
import { initWebMap, type MapInstanceHandle, type WebHazard } from "./web-map";

let handle: MapInstanceHandle | null = null;
let currentHazards: WebHazard[] = [];

const drawerList = document.getElementById("drawer-list");
const searchInput = document.getElementById("defect-search") as HTMLInputElement | null;
const drawer = document.getElementById("defect-drawer");

function renderDrawerList(items: WebHazard[]) {
  if (!drawerList) return;
  if (items.length === 0) {
    drawerList.innerHTML = `<div style="padding:24px; text-align:center; color:var(--ink-muted); font-size:12.5px; font-family:var(--font-mono);">No matching road defects in current filter.</div>`;
    return;
  }

  drawerList.innerHTML = items
    .map((h) => {
      const badgeClass = h.fixed
        ? "fixed"
        : h.kind === "pothole"
        ? "pothole"
        : h.kind === "speed_bump"
        ? "speed_bump"
        : "rough_pavement";

      const kindLabel = h.fixed
        ? "REPAIRED"
        : h.kind === "pothole"
        ? "POTHOLE"
        : h.kind === "speed_bump"
        ? "SPEED HUMP"
        : "ROUGH ROAD";

      const dateStr = h.firstSeen ? new Date(h.firstSeen).toLocaleDateString() : "RECORDED";

      return `
        <div class="defect-ledger-card" data-id="${h.id}">
          <div class="ledger-card-top">
            <span class="defect-kind-badge ${badgeClass}">${kindLabel}</span>
            <span style="font-family:var(--font-mono); font-size:11px; font-weight:700; color:var(--ink);">TIER ${h.severity}</span>
          </div>
          <div class="defect-coords-mono">GPS ${h.lat.toFixed(4)}°N, ${h.lng.toFixed(4)}°E</div>
          <div class="defect-meta-row">
            <span>Passes: <strong>${h.passes}</strong></span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach click listeners to fly to hazard
  drawerList.querySelectorAll(".defect-ledger-card").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-id");
      if (id && handle) {
        handle.flyToHazard(id);
      }
    });
  });
}

// Filter drawer on search input
searchInput?.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    renderDrawerList(currentHazards);
    return;
  }
  const filtered = currentHazards.filter(
    (h) =>
      h.kind.toLowerCase().includes(query) ||
      h.locationName.toLowerCase().includes(query) ||
      h.lat.toString().includes(query) ||
      h.lng.toString().includes(query)
  );
  renderDrawerList(filtered);
});

// Initialize map
handle = initWebMap(
  "full-map",
  "full-map-status",
  (h) => {
    handle = h;
  },
  (hazards) => {
    currentHazards = hazards;
    renderDrawerList(hazards);
  }
);

// Filter chip event handlers
document.querySelectorAll(".filter-milestone-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-milestone-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const kind = btn.getAttribute("data-kind") || "all";
    handle?.filterByKind(kind);

    const filtered =
      kind === "all"
        ? currentHazards
        : kind === "fixed"
        ? currentHazards.filter((h) => h.fixed)
        : currentHazards.filter((h) => h.kind === kind && !h.fixed);
    renderDrawerList(filtered);
  });
});

// Fit all hazards
document.getElementById("btn-fit-all")?.addEventListener("click", () => {
  handle?.fitAllHazards();
});

// Toggle drawer
document.getElementById("btn-toggle-drawer")?.addEventListener("click", () => {
  if (drawer) drawer.classList.toggle("hidden");
});
document.getElementById("btn-close-drawer")?.addEventListener("click", () => {
  if (drawer) drawer.classList.add("hidden");
});

// Export GeoJSON
document.getElementById("btn-export-geojson")?.addEventListener("click", () => {
  handle?.exportData("geojson");
});

// Export GPX
document.getElementById("btn-export-gpx")?.addEventListener("click", () => {
  handle?.exportData("gpx");
});

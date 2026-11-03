import "./cartographic.css";
import { initWebMap, type MapInstanceHandle, type WebHazard } from "./web-map";

let handle: MapInstanceHandle | null = null;
let currentHazards: WebHazard[] = [];

const drawerList = document.getElementById("drawer-list");
const searchInput = document.getElementById("defect-search") as HTMLInputElement | null;
const drawer = document.getElementById("defect-drawer");

function renderDrawerList(items: WebHazard[]) {
  if (!drawerList) return;
  if (items.length === 0) {
    drawerList.innerHTML = `<div style="padding:20px; text-align:center; color:#6B7280; font-size:12px;">No matching defects found.</div>`;
    return;
  }

  drawerList.innerHTML = items
    .map((h) => {
      const badgeBg = h.fixed
        ? "#15803D"
        : h.kind === "pothole"
        ? "#DC2626"
        : h.kind === "speed_bump"
        ? "#4F46E5"
        : "#D97706";

      const kindLabel =
        h.kind === "pothole"
          ? "Pothole"
          : h.kind === "speed_bump"
          ? "Speed Bump"
          : "Rough Road";

      const dateStr = h.firstSeen ? new Date(h.firstSeen).toLocaleDateString() : "Logged";

      return `
        <div class="defect-item" data-id="${h.id}">
          <div class="defect-item-top">
            <span class="defect-badge" style="background:${badgeBg};">${kindLabel}</span>
            <span style="font-size:11px; font-weight:700; color:#374151;">Tier ${h.severity}</span>
          </div>
          <div class="defect-coords">${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}</div>
          <div class="defect-meta">
            <span>Passes: ${h.passes}</span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach click listeners to fly to hazard
  drawerList.querySelectorAll(".defect-item").forEach((el) => {
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
document.querySelectorAll(".filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active"));
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

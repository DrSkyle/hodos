import "./cartographic.css";
import { initWebMap, type MapInstanceHandle } from "./web-map";

let handle: MapInstanceHandle | null = null;

// Initialize map immediately
handle = initWebMap("full-map", "full-map-status", (h) => {
  handle = h;
});

// Filter chip event handlers
document.querySelectorAll(".filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const kind = btn.getAttribute("data-kind") || "all";
    handle?.filterByKind(kind);
  });
});

// Fit all hazards
document.getElementById("btn-fit-all")?.addEventListener("click", () => {
  handle?.fitAllHazards();
});

// Export GeoJSON
document.getElementById("btn-export-geojson")?.addEventListener("click", () => {
  handle?.exportData("geojson");
});

// Export GPX
document.getElementById("btn-export-gpx")?.addEventListener("click", () => {
  handle?.exportData("gpx");
});

// Municipal modal
const modal = document.getElementById("modal-municipal");
document.getElementById("btn-municipal")?.addEventListener("click", () => {
  if (modal) modal.style.display = "flex";
});
document.getElementById("btn-close-modal")?.addEventListener("click", () => {
  if (modal) modal.style.display = "none";
});
modal?.addEventListener("click", (e) => {
  if (e.target === modal) modal.style.display = "none";
});

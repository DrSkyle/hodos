import "./cartographic.css";
import { initWebMap, type MapInstanceHandle } from "./web-map";

// Purge any legacy PWA service workers and caches
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((items) => Promise.all(items.map((item) => item.unregister())))
    .catch(() => {});
}
if ("caches" in window) {
  void caches
    .keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => {});
}

let handle: MapInstanceHandle | null = null;
let activeKind = "all";
const searchInput = document.getElementById("map-search-input") as HTMLInputElement | null;

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

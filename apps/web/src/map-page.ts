import "./cartographic.css";
import "./pwa";
import { initWebMap, type MapInstanceHandle } from "./web-map";

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

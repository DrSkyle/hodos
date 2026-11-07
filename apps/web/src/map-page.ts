import "./shadcn.css";
import {
  createIcons,
  ArrowLeft,
  Maximize2,
  List,
  Download,
  FileCode,
  Search,
  X,
  Sun,
  Moon
} from "lucide";
import { initWebMap, type MapInstanceHandle, type WebHazard } from "./web-map";

// 0. Unregister any legacy PWA service workers & caches so visitors never see stale shells
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

// 1. Initialize Lucide Icons
function initLucide() {
  createIcons({
    icons: {
      ArrowLeft,
      Maximize2,
      List,
      Download,
      FileCode,
      Search,
      X,
      Sun,
      Moon
    }
  });
}

// 2. Theme Toggle (Sync with Landing Page)
const html = document.documentElement;
const themeToggleBtn = document.getElementById("theme-toggle");

function applyTheme(theme: "dark" | "light") {
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
  initLucide();
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  applyTheme("dark");
} else {
  applyTheme("light");
}

themeToggleBtn?.addEventListener("click", () => {
  const isDark = html.classList.contains("dark");
  applyTheme(isDark ? "light" : "dark");
});

// 3. Map state & Defect Explorer Drawer
let handle: MapInstanceHandle | null = null;
let currentHazards: WebHazard[] = [];

const drawerList = document.getElementById("drawer-list");
const searchInput = document.getElementById("defect-search") as HTMLInputElement | null;
const drawer = document.getElementById("defect-drawer");

function renderDrawerList(items: WebHazard[]) {
  if (!drawerList) return;
  if (items.length === 0) {
    drawerList.innerHTML = `<div class="p-8 text-center text-xs text-muted-foreground">No matching defects found.</div>`;
    return;
  }

  drawerList.innerHTML = items
    .map((h) => {
      const badgeClass = h.fixed
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
        : h.kind === "pothole"
        ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
        : h.kind === "speed_bump"
        ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";

      const kindLabel =
        h.kind === "pothole"
          ? "Pothole"
          : h.kind === "speed_bump"
          ? "Speed Bump"
          : "Rough Road";

      const dateStr = h.firstSeen ? new Date(h.firstSeen).toLocaleDateString() : "Logged";
      const statusBadge = h.published
        ? `Verified (${h.passes} passes · ${h.devices} dev)`
        : `Pilot (${h.passes} ${h.passes > 1 ? "passes" : "pass"})`;

      return `
        <div class="card p-3 hover:border-foreground/40 transition-colors cursor-pointer flex flex-col gap-1.5" data-id="${h.id}">
          <div class="flex items-center justify-between">
            <span class="badge ${badgeClass} text-[11px] py-0.5">${kindLabel}</span>
            <span class="font-mono text-[11px] font-semibold text-muted-foreground">Tier ${h.severity}</span>
          </div>
          <div class="font-mono text-xs text-foreground font-medium">${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}</div>
          <div class="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
            <span>${statusBadge}</span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach click listeners to fly to hazard
  drawerList.querySelectorAll("[data-id]").forEach((el) => {
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

// Filter button event handlers (desktop tabs & mobile chips)
document.querySelectorAll(".tabs-trigger").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.getAttribute("data-kind") || "all";

    // Sync active state across all buttons with same data-kind
    document.querySelectorAll(".tabs-trigger").forEach((b) => {
      if (b.getAttribute("data-kind") === kind) {
        b.classList.add("active");
      } else {
        b.classList.remove("active");
      }
    });

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

// Initialize Lucide icons on load
initLucide();

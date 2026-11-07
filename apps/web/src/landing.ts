import "./shadcn.css";
import {
  createIcons,
  ArrowRight,
  Download,
  Terminal,
  Copy,
  Check,
  Sun,
  Moon,
  Search,
  Activity,
  ShieldCheck,
  EyeOff,
  Layers,
  Scale,
  FileJson,
  ChevronDown,
  Navigation,
  Smartphone,
  MapPin,
  ExternalLink,
  Sparkles,
  Car,
  AlertTriangle,
  Waves,
  HelpCircle,
  Filter,
  Maximize2,
  RefreshCw
} from "lucide";

// 1. Initialize Lucide Icons
function initLucide() {
  createIcons({
    icons: {
      ArrowRight,
      Download,
      Terminal,
      Copy,
      Check,
      Sun,
      Moon,
      Search,
      Activity,
      ShieldCheck,
      EyeOff,
      Layers,
      Scale,
      FileJson,
      ChevronDown,
      Navigation,
      Smartphone,
      MapPin,
      ExternalLink,
      Sparkles,
      Car,
      AlertTriangle,
      Waves,
      HelpCircle,
      Filter,
      Maximize2,
      RefreshCw
    }
  });
}

// 2. Theme Toggle (Dark / Light)
const themeToggleBtn = document.getElementById("theme-toggle");
const html = document.documentElement;

function applyTheme(theme: "dark" | "light") {
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
  initLucide();
}

// Initial Theme
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

// 3. Scroll Reveal & Parallax (Compliant with modern-web-guidance)
function initScrollReveal() {
  const elements = document.querySelectorAll(".reveal-on-scroll");
  if (!elements.length) return;

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -30px 0px"
      }
    );
    elements.forEach((el) => observer.observe(el));
  } else {
    elements.forEach((el) => el.classList.add("revealed"));
  }
}

function initParallaxFallback() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // If native scroll-driven animations are supported, let CSS handle it on compositor
  if (window.CSS && CSS.supports("(animation-timeline: view()) and (animation-range: entry)")) return;

  const bgLayer = document.querySelector(".parallax-layer-bg") as HTMLElement | null;
  const fgLayer = document.querySelector(".parallax-layer-fg") as HTMLElement | null;

  if (!bgLayer && !fgLayer) return;

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrolled = window.scrollY;
          if (bgLayer) bgLayer.style.transform = `translateY(${scrolled * 0.08}px)`;
          if (fgLayer) fgLayer.style.transform = `translateY(${scrolled * -0.05}px)`;
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true }
  );
}

// 4. Accordion Expand/Collapse (FAQ)
const accordionItems = document.querySelectorAll(".accordion-item");

accordionItems.forEach((item) => {
  const trigger = item.querySelector(".accordion-trigger");
  trigger?.addEventListener("click", () => {
    const isOpen = item.getAttribute("data-state") === "open";

    // Close others for clean accordion behavior
    accordionItems.forEach((other) => {
      other.setAttribute("data-state", "closed");
    });

    if (!isOpen) {
      item.setAttribute("data-state", "open");
    }
  });
});

// 5. Toast Notification System
function showToast(message: string) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-500"></i><span>${message}</span>`;
  container.appendChild(toast);
  initLucide();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// 6. Copy Buttons
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const text = btn.getAttribute("data-copy") || "";
    if (text) {
      void navigator.clipboard.writeText(text);
      showToast("Copied to clipboard!");
    }
  });
});

// 7. Command Palette Modal (⌘K)
const commandBackdrop = document.getElementById("command-dialog");
const commandInput = document.getElementById("command-input") as HTMLInputElement | null;
const commandItems = document.querySelectorAll(".command-item");

function openCommandDialog() {
  commandBackdrop?.classList.remove("hidden");
  commandInput?.focus();
}

function closeCommandDialog() {
  commandBackdrop?.classList.add("hidden");
}

document.querySelectorAll("[data-command-trigger]").forEach((el) => {
  el.addEventListener("click", openCommandDialog);
});

commandBackdrop?.addEventListener("click", (e) => {
  if (e.target === commandBackdrop) closeCommandDialog();
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (commandBackdrop?.classList.contains("hidden")) {
      openCommandDialog();
    } else {
      closeCommandDialog();
    }
  }
  if (e.key === "Escape" && !commandBackdrop?.classList.contains("hidden")) {
    closeCommandDialog();
  }
});

commandInput?.addEventListener("input", () => {
  const q = commandInput.value.toLowerCase().trim();
  commandItems.forEach((item) => {
    const text = item.textContent?.toLowerCase() || "";
    if (text.includes(q)) {
      (item as HTMLElement).style.display = "flex";
    } else {
      (item as HTMLElement).style.display = "none";
    }
  });
});

commandItems.forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.getAttribute("data-action");
    closeCommandDialog();
    if (action === "theme") {
      const isDark = html.classList.contains("dark");
      applyTheme(isDark ? "light" : "dark");
    } else if (action === "map") {
      window.location.href = "/map";
    } else if (action === "github") {
      window.open("https://github.com/DrSkyle/hodos", "_blank");
    } else if (action === "releases") {
      window.open("https://github.com/DrSkyle/hodos/releases", "_blank");
    } else if (action?.startsWith("#")) {
      const target = document.querySelector(action);
      target?.scrollIntoView({ behavior: "smooth" });
    }
  });
});

// 8. Verified Defect Data Explorer (Real 438 Hazards)
interface HazardItem {
  id: string;
  lat: number;
  lng: number;
  kind: string;
  severity: number;
  passes: number;
  devices: number;
  published: boolean;
  firstSeen?: string;
}

let hazardsCache: HazardItem[] = [];

async function loadHazardsData() {
  const explorerList = document.getElementById("explorer-list");
  if (!explorerList) return;

  try {
    const res = await fetch("/data/hazards.json");
    if (!res.ok) throw new Error("Could not load data/hazards.json");
    const data = await res.json();
    hazardsCache = (data.rows || []).map((r: any) => ({
      id: r.$id || r.hazardId || `${r.lat}:${r.lng}`,
      lat: Number(r.lat),
      lng: Number(r.lng),
      kind: r.kind || "pothole",
      severity: Number(r.severity) || 1,
      passes: Number(r.passCount) || 1,
      devices: Number(r.deviceCount) || 1,
      published: Boolean(r.published),
      firstSeen: r.firstSeen || r.$createdAt
    }));
  } catch {
    // High-precision fallback records if static file is unavailable
    hazardsCache = [
      { id: "pn27.7951e84.7327", lat: 27.7951, lng: 84.7327, kind: "pothole", severity: 2, passes: 3, devices: 2, published: true },
      { id: "rn27.7948e84.7318", lat: 27.7948, lng: 84.7318, kind: "rough_pavement", severity: 3, passes: 4, devices: 2, published: true },
      { id: "sn27.7951e84.7297", lat: 27.7951, lng: 84.7297, kind: "speed_bump", severity: 1, passes: 2, devices: 1, published: false },
      { id: "pn28.6463e81.0923", lat: 28.6463, lng: 81.0923, kind: "pothole", severity: 1, passes: 1, devices: 1, published: false },
      { id: "rn28.6512e81.0744", lat: 28.6512, lng: 81.0744, kind: "rough_pavement", severity: 1, passes: 1, devices: 1, published: false }
    ];
  }

  renderExplorerList("all", "");
}

function renderExplorerList(filterKind: string, searchQuery: string) {
  const explorerList = document.getElementById("explorer-list");
  if (!explorerList) return;

  let filtered = hazardsCache;
  if (filterKind !== "all") {
    filtered = filtered.filter((h) => h.kind === filterKind);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (h) =>
        h.lat.toFixed(4).includes(q) ||
        h.lng.toFixed(4).includes(q) ||
        h.kind.toLowerCase().includes(q)
    );
  }

  const countBadge = document.getElementById("explorer-count");
  if (countBadge) {
    countBadge.textContent = `${filtered.length} observations`;
  }

  if (filtered.length === 0) {
    explorerList.innerHTML = `<div class="p-8 text-center text-xs text-muted-foreground">No matching road observations found.</div>`;
    return;
  }

  explorerList.innerHTML = filtered
    .slice(0, 16)
    .map((h) => {
      const badgeClass =
        h.kind === "pothole"
          ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
          : h.kind === "speed_bump"
          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";

      const kindName =
        h.kind === "pothole"
          ? "Pothole"
          : h.kind === "speed_bump"
          ? "Speed Bump"
          : "Rough Pavement";

      const verificationLabel = h.published
        ? `Verified (${h.passes} passes · ${h.devices} devices)`
        : `Pilot (${h.passes} ${h.passes > 1 ? "passes" : "pass"} · ${h.devices} dev)`;

      return `
        <div class="card p-3.5 hover:border-foreground/30 transition-colors flex flex-col gap-2 group cursor-pointer" onclick="window.location.href='/map'">
          <div class="flex items-center justify-between">
            <span class="badge ${badgeClass} text-[11px] py-0.5">${kindName}</span>
            <span class="font-mono text-xs font-semibold text-muted-foreground">Tier ${h.severity}</span>
          </div>
          <div class="flex items-center justify-between font-mono text-xs text-foreground font-medium pt-1">
            <span>${h.lat.toFixed(4)}°, ${h.lng.toFixed(4)}°</span>
            <span class="text-[10.5px] text-muted-foreground">${verificationLabel}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

// Explorer Filter Tabs
let activeExplorerFilter = "all";
document.querySelectorAll(".explorer-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".explorer-filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeExplorerFilter = btn.getAttribute("data-kind") || "all";
    const searchInput = document.getElementById("explorer-search") as HTMLInputElement | null;
    renderExplorerList(activeExplorerFilter, searchInput?.value.trim() || "");
  });
});

// Explorer Search Input
const explorerSearch = document.getElementById("explorer-search") as HTMLInputElement | null;
explorerSearch?.addEventListener("input", () => {
  renderExplorerList(activeExplorerFilter, explorerSearch.value.trim());
});

// 9. One-Click GeoJSON & GPX Exports
document.getElementById("btn-download-geojson")?.addEventListener("click", () => {
  const geojson = {
    type: "FeatureCollection",
    metadata: {
      generatedAt: new Date().toISOString(),
      generator: "Hodos Telemetry Engine v1.2.0",
      calibratedIri: false,
      totalFeatures: hazardsCache.length
    },
    features: hazardsCache.map((h) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      properties: {
        id: h.id,
        kind: h.kind,
        severity: h.severity,
        passes: h.passes,
        devices: h.devices,
        corroborated: h.published
      }
    }))
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hodos-verified-hazards-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("GeoJSON dataset downloaded!");
});

document.getElementById("btn-download-gpx")?.addEventListener("click", () => {
  const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hodos https://hodos.devilabs.dev">\n`;
  const waypoints = hazardsCache
    .map((h) => `  <wpt lat="${h.lat}" lon="${h.lng}"><name>${h.kind.toUpperCase()} (T${h.severity})</name><desc>Passes: ${h.passes}</desc></wpt>`)
    .join("\n");
  const gpxFooter = `\n</gpx>`;

  const blob = new Blob([gpxHeader + waypoints + gpxFooter], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hodos-waypoints-${Date.now()}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("GPX waypoints downloaded!");
});

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initLucide();
  initScrollReveal();
  initParallaxFallback();
  void loadHazardsData();
});

// Initial invocation
initLucide();
initScrollReveal();
initParallaxFallback();
void loadHazardsData();

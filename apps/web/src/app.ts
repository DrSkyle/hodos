import "./cartographic.css";
import "./garage.css";
import "./app.css";
import "./pwa";
import { initWebMap } from "./web-map";
import { installPromptAvailable, promptInstall } from "./pwa";
import { state } from "./app/state";
import {
  currentStats,
  finish,
  flushOutbox,
  isRecording,
  loadHazards,
  start,
  type LiveStats,
  type RemoteHazard
} from "./app/recorder";
import {
  PERMISSION_COPY,
  keepAwakeOnReturn,
  listenMotion,
  permissionState,
  requestLocation,
  requestMotion,
  requestNotifications,
  requestWakeLock,
  releaseWakeLock,
  setPermissionState,
  watchPosition,
  type PermissionName
} from "./app/sensors";
import {
  renderDriveScreen,
  renderGarageScreen,
  renderInsightsScreen,
  renderMapScreen,
  renderNav,
  renderNearby,
  renderRoadsScreen,
  renderYouScreen,
  updateDriveStats,
  SCREENS,
  toast,
  type ScreenId
} from "./app/ui";

/**
 * Hodos Web: the same app as the Android build, in a browser tab.
 *
 * The map, the detector and the upload format are identical. The one real
 * difference is announced in the Drive screen rather than hidden: a browser
 * page stops sensing when it is backgrounded.
 */

const railNav = document.getElementById("rail-nav") as HTMLElement;
const routeNav = document.getElementById("app-route") as HTMLElement;
const installButton = document.getElementById("rail-install") as HTMLButtonElement;
const toastHost = document.getElementById("app-toast") as HTMLElement;
const screens: Record<ScreenId, HTMLElement> = {
  map: document.getElementById("screen-map") as HTMLElement,
  drive: document.getElementById("screen-drive") as HTMLElement,
  garage: document.getElementById("screen-garage") as HTMLElement,
  roads: document.getElementById("screen-roads") as HTMLElement,
  insights: document.getElementById("screen-insights") as HTMLElement,
  you: document.getElementById("screen-you") as HTMLElement
};

let active: ScreenId = "map";
let hazards: RemoteHazard[] = [];
let shops: string[] = [];
let mapStarted = false;
let ticking = false;

function show(id: ScreenId) {
  active = id;
  for (const [key, host] of Object.entries(screens) as [ScreenId, HTMLElement][]) {
    host.hidden = key !== id;
  }
  renderNav(railNav, id, show);
  renderNav(routeNav, id, show);
  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
  render();
}

function render() {
  const stats = currentStats();
  if (active === "map") {
    renderMapScreen(screens.map, stats);
    if (!mapStarted) {
      mapStarted = true;
      initWebMap("app-map", "app-map-status", () => {
        // The shared map owns its own hazard rendering; the sheet is ours.
        void refreshHazards();
      });
    }
    renderNearby(screens.map, hazards);
    return;
  }
  if (active === "drive") {
    renderDriveScreen(screens.drive, stats, state.outbox.length);
    wireDrive();
    return;
  }
  if (active === "garage") {
    void renderGarageScreen(screens.garage, render);
    return;
  }
  if (active === "roads") {
    renderRoadsScreen(screens.roads);
    screens.roads.querySelectorAll<HTMLButtonElement>("[data-profile]").forEach((button) => {
      button.addEventListener("click", () => {
        const profile = button.dataset.profile as typeof state.profile | undefined;
        if (!profile) return;
        state.setProfile(profile);
        render();
      });
    });
    return;
  }
  if (active === "insights") {
    renderInsightsScreen(screens.insights, hazards);
    return;
  }
  renderYou(screens.you);
}

function renderYou(host: HTMLElement) {
  renderYouScreen(host, { shops, installable: installPromptAvailable() });
  host.querySelector("#you-install")?.addEventListener("click", async () => {
    const outcome = await promptInstall();
    if (outcome === "unavailable") toast(toastHost, "Use your browser menu to add Hodos to the home screen.");
    render();
  });
  host.querySelector("#you-clear")?.addEventListener("click", () => {
    state.clearHistory();
    toast(toastHost, "Local history deleted");
    show("you");
  });
}

/* ------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------ */

async function askFor(name: PermissionName): Promise<void> {
  if (name === "location") await requestLocation();
  if (name === "motion") await requestMotion();
  if (name === "notifications") await requestNotifications();
  if (name === "wakeLock") await requestWakeLock();

  const now = permissionState(name);
  if (now === "denied") {
    toast(toastHost, `${PERMISSION_COPY[name].title} is blocked in this browser's site settings.`);
  } else if (now === "unsupported") {
    toast(toastHost, `${PERMISSION_COPY[name].title} is not available on this device.`);
  } else if (now === "granted") {
    toast(toastHost, `${PERMISSION_COPY[name].title} allowed`);
  }
  render();
}

/* ------------------------------------------------------------------ *
 * Drive
 * ------------------------------------------------------------------ */

function wireDrive() {
  const host = screens.drive;
  host.querySelectorAll<HTMLButtonElement>("[data-permission]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.permission as PermissionName | undefined;
      if (name) void askFor(name);
    });
  });

  const note = host.querySelector("#drive-note") as HTMLElement | null;
  if (note) {
    if (isRecording()) {
      note.innerHTML = "Sensors are live. Keep this tab open — a browser pauses sensing when it is hidden.";
    } else {
      note.innerHTML =
        permissionState("location") === "granted" && permissionState("motion") === "granted"
          ? "Ready. Start driving and Hodos will find impacts on its own."
          : "Allow location and motion first; the two are what make detection possible.";
    }
  }

  host.querySelector("#drive-check")?.addEventListener("click", () => {
    for (const name of ["location", "motion"] as PermissionName[]) {
      // Reading a permission state never prompts; the buttons above do that.
      if (permissionState(name) === "unknown") setPermissionState(name, "unknown");
    }
    toast(toastHost, "Tap each row to grant it. Nothing is enabled without your tap.");
  });

  host.querySelector("#drive-toggle")?.addEventListener("click", () => {
    if (isRecording()) {
      const finished = finish();
      if (finished) {
        state.addTrip(finished.trip, finished.trail);
        toast(toastHost, `Journey saved · ${finished.trip.impacts} impacts`);
      }
      void releaseWakeLock();
      void flushOutbox().then((result) => {
        if (result.sent > 0) toast(toastHost, `${result.sent} observation${result.sent === 1 ? "" : "s"} uploaded`);
      });
      render();
      return;
    }

    start(
      (live: LiveStats) => {
        if (active === "map") renderMapScreen(screens.map, live);
        if (active === "drive") updateDriveStats(screens.drive, live, state.outbox.length);
      },
      (impact) => {
        toast(toastHost, `Impact found · severity ${impact.severity}`);
      },
      (handlers) => {
        const stopMotion = listenMotion(handlers.onSample);
        const stopWatch = watchPosition(handlers.onFix, (message) => {
          toast(toastHost, `Location: ${message}`);
        });
        return { stopMotion, stopWatch };
      }
    );
    render();
  });
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

async function refreshHazards() {
  try {
    hazards = await loadHazards();
  } catch (_) {
    hazards = [];
  }
  if (active === "map") renderNearby(screens.map, hazards);
  if (active === "insights") renderInsightsScreen(screens.insights, hazards);
}

async function loadShops() {
  try {
    const query = encodeURIComponent(JSON.stringify({ method: "limit", values: [100] }));
    const response = await fetch(
      `https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/partners/rows?queries[]=${query}`,
      { headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" } }
    );
    if (!response.ok) return;
    const body = await response.json();
    const now = Date.now();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    shops = rows
      .filter((row: { activeUntil?: string; name?: string }) => {
        const until = Date.parse(String(row.activeUntil ?? ""));
        return !(Number.isFinite(until) && until < now) && typeof row.name === "string" && row.name.length > 0;
      })
      .map((row: { name: string }) => row.name)
      .slice(0, 6);
  } catch (_) {
    shops = [];
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  const hash = location.hash.replace("#", "") as ScreenId;
  active = SCREENS.some((screen) => screen.id === hash) ? hash : "map";
  renderNav(railNav, active, show);
  renderNav(routeNav, active, show);
  for (const [key, host] of Object.entries(screens) as [ScreenId, HTMLElement][]) {
    host.hidden = key !== active;
  }
  render();

  keepAwakeOnReturn();
  void refreshHazards();
  void loadShops();

  window.addEventListener("online", () => {
    void flushOutbox();
    void refreshHazards();
  });

  // Flush queued observations without blocking the UI, and keep the sheet
  // fresh while the app is open.
  window.setInterval(() => {
    if (state.outbox.length > 0) void flushOutbox();
  }, 45_000);

  window.setInterval(() => {
    if (ticking || document.visibilityState !== "visible") return;
    ticking = true;
    void refreshHazards().finally(() => {
      ticking = false;
    });
  }, 120_000);

  installButton.hidden = true;
  window.addEventListener("beforeinstallprompt", () => {
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    const outcome = await promptInstall();
    if (outcome !== "unavailable") installButton.hidden = true;
  });
}

boot();

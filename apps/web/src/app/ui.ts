import {
  DEFAULT_GARAGE_SLOT_ID,
  GARAGE_SLOTS,
  loadOffers,
  money,
  offerMeta,
  wasPrice,
  GARAGE_SLOT_STORAGE_KEY
} from "../garage-client";
import type { GearOffer } from "../garage-client";
import { state, type Trip } from "./state";
import type { LiveStats, RemoteHazard } from "./recorder";
import {
  cellsFromTrails,
  deteriorationWatch,
  repairClusters,
  smoothRouteScore,
  smoothRouteSummary,
  surfaceShare,
  wearEstimate
} from "./roads";
import { PERMISSION_COPY, permissionState, type PermissionName } from "./sensors";

export type ScreenId = "map" | "drive" | "garage" | "roads" | "insights" | "you";

export const SCREENS: { id: ScreenId; label: string; accent?: boolean; icon: string }[] = [
  { id: "map", label: "Map", icon: icon("map") },
  { id: "drive", label: "Drive", icon: icon("car") },
  { id: "garage", label: "Garage", accent: true, icon: icon("bag") },
  { id: "roads", label: "Roads", icon: icon("road") },
  { id: "insights", label: "Insights", icon: icon("chart") },
  { id: "you", label: "You", icon: icon("person") }
];

function icon(name: "map" | "car" | "bag" | "road" | "chart" | "person"): string {
  const paths: Record<string, string> = {
    map: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2.2 4.6L8.4 15l2.2-4.6z"/>',
    car: '<path d="M4 15h16M6.5 15V9.6l2-3.1h7l2 3.1V15"/><circle cx="8" cy="17.5" r="1.4"/><circle cx="16" cy="17.5" r="1.4"/>',
    bag: '<path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8V6.6a3 3 0 0 1 6 0V8"/>',
    road: '<path d="M8 4l-2.6 16M16 4l2.6 16M12 6v2M12 11v2M12 16v2"/>',
    chart: '<path d="M4 19V9M10 19V5M16 19v-6M22 19H2"/>',
    person: '<circle cx="12" cy="8.5" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

export function renderNav(navHost: HTMLElement, active: ScreenId, onSelect: (id: ScreenId) => void) {
  navHost.replaceChildren();
  for (const screen of SCREENS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = navHost.classList.contains("app-route") ? "route-stop" : "rail-stop";
    button.dataset.screen = screen.id;
    if (screen.accent) button.dataset.accent = "true";
    if (screen.id === active) button.setAttribute("aria-current", "page");
    button.innerHTML = `${screen.icon}<span>${screen.label}</span>`;
    button.addEventListener("click", () => onSelect(screen.id));
    navHost.append(button);
  }
}

export function counterText(stats: LiveStats): string {
  const waiting = [
    stats.recording && stats.fixes === 0 ? "waiting for a position" : "",
    stats.recording && stats.samples === 0 ? "waiting for motion" : ""
  ].filter(Boolean);
  return `GPS fixes ${stats.fixes} · motion samples ${stats.samples}${waiting.length ? ` · ${waiting.join(" · ")}` : ""}`;
}

/**
 * Patches the live numbers without re-rendering the screen, so a running
 * recording never loses the button you are about to press.
 */
export function updateDriveStats(host: HTMLElement, stats: LiveStats, pending: number) {
  const set = (id: string, value: string) => {
    const node = host.querySelector(`#${id}`);
    if (node) node.textContent = value;
  };
  set("drive-km", (stats.distanceM / 1000).toFixed(1));
  set("drive-impacts", String(stats.impacts));
  set("drive-speed", stats.speedKph > 0 ? String(Math.round(stats.speedKph)) : "—");
  set("drive-accuracy", stats.accuracyM != null ? `±${Math.round(stats.accuracyM)}` : "—");
  set("drive-counters", counterText(stats));
  const queued = host.querySelector(".record-pill + .mono");
  if (queued) queued.textContent = `${pending} queued`;
}

export function screenHead(title: string, subtitle: string): string {
  return `<div class="screen-head"><div><h1>${escapeHtml(title)}</h1><p>${subtitle}</p></div></div>`;
}

export function stat(value: string, label: string): string {
  return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
}

export function toast(host: HTMLElement, message: string, ms = 3200) {
  host.textContent = message;
  host.hidden = false;
  window.clearTimeout((host as HTMLElement & { _t?: number })._t);
  (host as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
    host.hidden = true;
  }, ms);
}

/* ------------------------------------------------------------------ *
 * Map
 * ------------------------------------------------------------------ */

export function renderMapScreen(host: HTMLElement, stats: LiveStats) {
  if (host.dataset.ready === "true") {
    const pill = host.querySelector(".map-pill");
    if (pill) {
      pill.classList.toggle("is-recording", stats.recording);
      const text = pill.querySelector("span");
      if (text) {
        text.textContent = stats.recording
          ? `Recording · ${(stats.distanceM / 1000).toFixed(1)} km · ${stats.impacts} found`
          : "Road map";
      }
    }
    return;
  }
  host.dataset.ready = "true";
  host.innerHTML = `
    <div class="map-screen">
      <div id="app-map"></div>
      <div class="map-floating">
        <div class="map-pill${stats.recording ? " is-recording" : ""}">
          <span class="dot-live" aria-hidden="true"></span>
          <span>${stats.recording ? "Recording" : "Road map"}</span>
        </div>
        <span class="visually-hidden" id="app-map-status"></span>
      </div>
      <div class="map-legend" aria-hidden="true">
        <div class="legend-line"><span class="legend-dot" style="background:var(--pothole)"></span>Pothole</div>
        <div class="legend-line"><span class="legend-dot" style="background:var(--rough)"></span>Rough road</div>
        <div class="legend-line"><span class="legend-dot" style="background:var(--bump)"></span>Speed bump</div>
        <div class="legend-line"><span class="legend-dot" style="background:var(--fixed)"></span>Repaired</div>
      </div>
      <div class="map-sheet" id="app-map-sheet">
        <h2>Nearby</h2>
        <p class="mono" id="app-map-count">Reading the map…</p>
        <div class="rows" id="app-map-rows"></div>
      </div>
    </div>
  `;
}

export function renderNearby(host: HTMLElement, hazards: RemoteHazard[]) {
  const rows = host.querySelector("#app-map-rows");
  const count = host.querySelector("#app-map-count");
  if (!rows || !count) return;
  const open = hazards.filter((hazard) => !hazard.fixed);
  const fixed = hazards.filter((hazard) => hazard.fixed);
  count.textContent =
    hazards.length === 0
      ? "No published observations yet"
      : `${open.length} open · ${fixed.length} repaired`;
  rows.innerHTML = "";
  const ordered = [...open.sort((a, b) => b.severity - a.severity), ...fixed].slice(0, 6);
  if (ordered.length === 0) {
    rows.innerHTML = `<p class="note">Nothing has been corroborated near you yet. Driving with Hodos armed is what puts roads on the map.</p>`;
    return;
  }
  for (const hazard of ordered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "hazard-line";
    const colour = hazard.fixed
      ? "var(--fixed)"
      : hazard.kind === "speed_bump"
      ? "var(--bump)"
      : hazard.kind === "rough_pavement"
      ? "var(--rough)"
      : "var(--pothole)";
    row.innerHTML = `
      <span class="dot" style="background:${hazard.fixed ? "transparent" : colour};box-shadow:inset 0 0 0 2px ${colour}"></span>
      <span class="grow"><strong>${escapeHtml(title(hazard))}</strong>
      <small>${hazard.passes} pass${hazard.passes === 1 ? "" : "es"} · ${hazard.devices} device${hazard.devices === 1 ? "" : "s"}</small></span>
      <span class="right">${hazard.fixed ? "repaired" : `L${hazard.severity}`}</span>
    `;
    rows.append(row);
  }
}

function title(hazard: RemoteHazard): string {
  if (hazard.fixed) return "Repaired stretch";
  if (hazard.kind === "speed_bump") return "Speed bump";
  if (hazard.kind === "rough_pavement") return "Rough stretch";
  return "Pothole";
}

/* ------------------------------------------------------------------ *
 * Drive
 * ------------------------------------------------------------------ */

const PERMISSION_ORDER: { name: PermissionName; icon: string }[] = [
  { name: "location", icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>' },
  { name: "motion", icon: '<path d="M3 12h3l2-5 3 10 2.5-7 2 4h5.5"/>' },
  { name: "notifications", icon: '<path d="M6 16v-4a6 6 0 1 1 12 0v4l1.6 2.4H4.4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>' },
  { name: "wakeLock", icon: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/>' }
];

export function renderDriveScreen(host: HTMLElement, stats: LiveStats, pending: number) {
  const rows = PERMISSION_ORDER.map(({ name, icon: glyph }) => {
    const copy = PERMISSION_COPY[name];
    const st = permissionState(name);
    const label =
      st === "granted" ? "Allowed" : st === "denied" ? "Blocked" : st === "unsupported" ? "Not available" : copy.required ? "Needed" : "Optional";
    return `
      <button class="prompt" type="button" data-permission="${name}" data-state="${st}">
        <span class="prompt-icon">${glyph.replace("<svg", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"')}</span>
        <span class="grow"><strong>${copy.title}</strong><span>${copy.detail}</span></span>
        <span class="prompt-state">${label}</span>
      </button>`;
  }).join("");

  host.innerHTML = `
    <div class="screen-pad">
      ${screenHead("Drive", "Hodos reads the road while you drive. Same engine as the Android app, running in this tab.")}
      <div class="panel">
        <div class="chip-row" style="padding-bottom:0">
          <span class="record-pill" ${stats.recording ? "" : 'style="background:var(--soft);color:var(--ink)"'}>
            ${stats.recording ? '<span class="dot-live" aria-hidden="true"></span>' : ""}
            ${stats.recording ? "Recording" : "Idle"}
          </span>
          <span class="mono" style="align-self:center">${pending} queued</span>
        </div>
        <div class="stat-row">
          <div class="stat"><strong id="drive-km">${(stats.distanceM / 1000).toFixed(1)}</strong><span>km this journey</span></div>
          <div class="stat"><strong id="drive-impacts">${stats.impacts}</strong><span>impacts found</span></div>
          <div class="stat"><strong id="drive-speed">${stats.speedKph > 0 ? Math.round(stats.speedKph) : "—"}</strong><span>km/h now</span></div>
          <div class="stat"><strong id="drive-accuracy">${stats.accuracyM != null ? `±${Math.round(stats.accuracyM)}` : "—"}</strong><span>GPS accuracy m</span></div>
        </div>
        <p class="mono" id="drive-counters" style="margin-top:14px">${counterText(stats)}</p>
        <div class="btn-row">
          <button class="app-btn" type="button" id="drive-toggle">${stats.recording ? "Finish journey" : "Start driving"}</button>
          <button class="app-btn app-btn-soft" type="button" id="drive-check">Check permissions</button>
        </div>
        <p class="note" id="drive-note"></p>
      </div>

      <div class="panel">
        <h2>Permissions</h2>
        <p>Hodos asks for each one in the open. Nothing is enabled before you tap it.</p>
        <div class="prompt-list">${rows}</div>
        <p class="note">
          <strong>A browser has one limit the Android app does not:</strong> sensing pauses
          when this tab is in the background or the screen locks. Keep Hodos open on the
          dashboard while you drive. On iPhone and iPad, motion access also needs a tap on
          the Motion row, which is an Apple requirement for web apps.
        </p>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * Garage
 * ------------------------------------------------------------------ */

let garageSlot = (() => {
  try {
    return localStorage.getItem(GARAGE_SLOT_STORAGE_KEY) ?? DEFAULT_GARAGE_SLOT_ID;
  } catch (_) {
    return DEFAULT_GARAGE_SLOT_ID;
  }
})();

export async function renderGarageScreen(host: HTMLElement, rerender: () => void) {
  host.innerHTML = `
    <div class="screen-pad">
      ${screenHead("The Garage", "Kit worth keeping in the car, priced by the shop that sells it. Every purchase keeps the map free.")}
      <div class="chip-row" role="tablist" aria-label="Garage shelves"></div>
      <div class="panel"><p class="mono" id="garage-status">Reading the shelf…</p><div class="rows" id="garage-rows"></div></div>
    </div>
  `;

  const chips = host.querySelector(".chip-row") as HTMLElement;
  for (const slot of GARAGE_SLOTS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(slot.id === garageSlot));
    chip.textContent = slot.label;
    chip.addEventListener("click", () => {
      garageSlot = slot.id;
      try {
        localStorage.setItem(GARAGE_SLOT_STORAGE_KEY, slot.id);
      } catch (_) {
        // Private mode: the choice simply resets next visit.
      }
      rerender();
    });
    chips.append(chip);
  }

  const status = host.querySelector("#garage-status") as HTMLElement;
  const rows = host.querySelector("#garage-rows") as HTMLElement;
  try {
    const offers = await loadOffers(garageSlot);
    status.textContent = offers.length === 0 ? "Nothing on this shelf right now" : `${offers.length} picks · prices from the shops`;
    rows.innerHTML = "";
    for (const offer of offers) rows.append(offerRow(offer));
  } catch (_) {
    status.textContent = "The shelf is unreachable right now";
  }
}

function offerRow(offer: GearOffer): HTMLElement {
  const row = document.createElement("div");
  row.className = "offer";
  const before = wasPrice(offer);
  row.innerHTML = `
    ${offer.image ? `<img src="${escapeHtml(offer.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
    <span class="grow">
      <strong>${escapeHtml(offer.title)}</strong>
      <small>${escapeHtml(offerMeta(offer))}</small>
    </span>
    <span class="price">${money(offer.price, offer.currency)}${before ? ` <s style="font-weight:500;color:var(--muted);font-size:11px">${before}</s>` : ""}</span>
    <a href="${escapeHtml(offer.url)}" target="_blank" rel="sponsored noopener noreferrer">View ↗</a>
  `;
  return row;
}

/* ------------------------------------------------------------------ *
 * Roads
 * ------------------------------------------------------------------ */

export function renderRoadsScreen(host: HTMLElement) {
  const cells = cellsFromTrails(state.trails);
  const shares = surfaceShare(cells);
  const profile = state.profile;
  const wear = wearEstimate(cells, profile);
  const smooth = smoothRouteScore(cells);

  const shareRows = shares
    .map(
      (item) => `
      <div class="row">
        <span class="grow"><strong>${item.kind}</strong><small>${Math.round(item.meters)} m recorded</small></span>
        <span class="value">${Math.round(item.share * 100)}%</span>
      </div>
      <div class="bar" aria-hidden="true"><i style="width:${Math.round(item.share * 100)}%"></i></div>`
    )
    .join("");

  const corridorRows = cells
    .slice(0, 8)
    .map(
      (cell) => `
      <div class="row">
        <span class="legend-dot" style="background:${cell.quality >= 80 ? "var(--fixed)" : cell.quality >= 55 ? "var(--rough)" : "var(--pothole)"}"></span>
        <span class="grow"><strong>${cell.grade} · ${cell.surface}</strong>
        <small>${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)} · ${cell.passes} fixes</small></span>
        <span class="value">${cell.quality}</span>
      </div>`
    )
    .join("");

  const profiles: { id: typeof profile; label: string }[] = [
    { id: "mixed", label: "Mixed fleet" },
    { id: "car", label: "Car" },
    { id: "scooter", label: "Scooter" },
    { id: "bike", label: "Bicycle" }
  ];

  host.innerHTML = `
    <div class="screen-pad">
      ${screenHead("Roads", "Surface mix, corridor quality and what this road costs your vehicle — computed on this device from your own drives.")}
      <div class="panel">
        <h2>Surface mix</h2>
        ${shares.length === 0 ? `<p>No journeys recorded here yet. Arm Hodos on the Drive screen, take one trip, and this fills in.</p>` : shareRows}
      </div>
      <div class="panel">
        <h2>Vehicle wear</h2>
        <p>${wear.vehicleLabel} · ${wear.distanceKm.toFixed(1)} km recorded</p>
        <div class="stat-row">
          ${stat(String(wear.loadIndex), "load index / 1000")}
          ${stat(`$${wear.repairCostLow}`, "repair floor")}
          ${stat(`$${wear.repairCostHigh}`, "repair ceiling")}
          ${stat(smooth != null ? String(smooth) : "—", "smooth-route ceiling")}
        </div>
        <div class="btn-row">
          ${profiles
            .map(
              (item) =>
                `<button class="chip" type="button" data-profile="${item.id}" aria-selected="${item.id === profile}">${item.label}</button>`
            )
            .join("")}
        </div>
        <p class="note">The repair band is an estimate for comparing corridors, not a quote. It is calculated on this device and never uploaded.</p>
      </div>
      <div class="panel">
        <h2>Corridors</h2>
        ${corridorRows || `<p>Nothing measured yet.</p>`}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * Insights
 * ------------------------------------------------------------------ */

export function renderInsightsScreen(host: HTMLElement, hazards: RemoteHazard[]) {
  const watch = deteriorationWatch(hazards);
  const clusters = repairClusters(hazards);
  const cells = cellsFromTrails(state.trails);
  const smooth = smoothRouteScore(cells);
  const summary = smoothRouteSummary(cells);

  host.innerHTML = `
    <div class="screen-pad">
      ${screenHead("Insights", "Where the road is getting worse, and where a repair would land hardest.")}
      <div class="panel">
        <h2>Worsening watchlist</h2>
        ${
          watch.length === 0
            ? `<p>Nothing on the watchlist. It fills from corroborated hazards on the public map.</p>`
            : `<div class="rows">${watch
                .map(
                  (row) => `
                  <div class="row">
                    <span class="grow"><strong>${title(row.hazard)}</strong>
                    <small>${row.hazard.passes} passes · ${row.ageDays}d since last seen</small></span>
                    <span class="value">${row.risk}</span>
                  </div>`
                )
                .join("")}</div>`
        }
      </div>
      <div class="panel">
        <h2>Repair clusters</h2>
        ${
          clusters.length === 0
            ? `<p>No open hazards to group yet.</p>`
            : `<div class="rows">${clusters
                .map(
                  (cluster) => `
                  <div class="row">
                    <span class="grow"><strong>${cluster.hazards} hazard${cluster.hazards === 1 ? "" : "s"} together</strong>
                    <small>${cluster.lat.toFixed(4)}, ${cluster.lng.toFixed(4)}</small></span>
                    <span class="value">${Math.round(cluster.share * 100)}%</span>
                  </div>`
                )
                .join("")}</div>`
        }
      </div>
      <div class="panel">
        <h2>Smooth route</h2>
        ${
          smooth == null
            ? `<p>Record a journey and this estimates what a smooth-route profile could promise on your corridor.</p>`
            : `<div class="stat-row">${stat(String(smooth), "smooth-route ceiling")}${stat(String(cells.length), "cells measured")}</div>
               <p>${summary ? escapeHtml(summary) : "Take one more trip along the same corridor to compare stretches."}</p>`
        }
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * You
 * ------------------------------------------------------------------ */

export function renderYouScreen(host: HTMLElement, options: { shops: string[]; installable: boolean }) {
  const trips = state.trips;
  const totalKm = trips.reduce((sum, trip) => sum + (trip.distanceM || 0), 0) / 1000;
  const month = monthTrips(trips);
  const monthKm = month.reduce((sum, trip) => sum + (trip.distanceM || 0), 0) / 1000;
  const tiers = [
    { at: 20, label: "Free tire pressure check" },
    { at: 50, label: "Free chain lube" },
    { at: 100, label: "Free alignment check" }
  ];
  const unlocked = tiers.filter((tier) => monthKm >= tier.at);
  const next = tiers.find((tier) => monthKm < tier.at);
  const progress = next ? Math.min(1, monthKm / next.at) : 1;

  host.innerHTML = `
    <div class="screen-pad">
      ${screenHead("You", "Everything here lives in this browser. No account, no email, no identifier that follows you.")}
      <div class="panel">
        <h2>Your perks</h2>
        <p>${monthKm.toFixed(1)} km this month · ${month.length} journey${month.length === 1 ? "" : "s"}</p>
        <div class="bar" aria-hidden="true"><i style="width:${Math.round(progress * 100)}%"></i></div>
        <p class="note">${next ? `${(next.at - monthKm).toFixed(1)} km to: ${next.label}` : "All monthly perks unlocked."}</p>
        ${
          unlocked.length
            ? `<div class="rows">${unlocked
                .map(
                  (tier) =>
                    `<div class="row"><span class="grow"><strong>${tier.label}</strong><small>${tier.at} km tier</small></span><span class="value">✓</span></div>`
                )
                .join("")}</div>
               <p class="note">${
                 options.shops.length
                   ? `Redeem at: ${options.shops.map(escapeHtml).join(", ")}`
                   : "No partner shop is listed on the map near you yet."
               }</p>`
            : `<p class="note">Perks unlock from distance you already drive this month.</p>`
        }
        <p class="note">Only the display changes with the distance; the count itself never leaves this browser.</p>
      </div>

      <div class="panel">
        <h2>History</h2>
        <div class="stat-row">
          ${stat(String(trips.length), "journeys")}
          ${stat(totalKm.toFixed(1), "km mapped")}
          ${stat(String(trips.reduce((sum, trip) => sum + (trip.impacts || 0), 0)), "impacts found")}
          ${stat(String(state.savedRoads.length), "saved roads")}
        </div>
        <div class="rows">${
          trips
            .slice(0, 6)
            .map(
              (trip) => `<div class="row">
                <span class="grow"><strong>${new Date(trip.at).toLocaleString()}</strong>
                <small>${(trip.distanceM / 1000).toFixed(1)} km · ${trip.impacts} impacts${trip.durationS ? ` · ${Math.round(trip.durationS / 60)} min` : ""}</small></span>
              </div>`
            )
            .join("") || `<p>No journeys recorded in this browser yet.</p>`
        }</div>
      </div>

      <div class="panel">
        <h2>This browser</h2>
        <p>Install Hodos to open the map in one tap and keep the shell offline. Journeys, trails and saved roads stay on this device; only anonymous hazard reports are ever uploaded.</p>
        <div class="btn-row">
          ${options.installable ? `<button class="app-btn" type="button" id="you-install">Install Hodos</button>` : ""}
          <a class="app-btn app-btn-soft" href="/map/">Open the full map</a>
          <a class="app-btn app-btn-soft" href="/partners/">For shops</a>
        </div>
      </div>

      <div class="panel">
        <h2>Privacy</h2>
        <p>The installation id is a random value created here. Journeys and trails never leave the device. Only anonymous hazard observations are posted, with no account and no advertising id.</p>
        <p>The first and last 250 metres of a journey are trimmed on the phone in the Android app; here, no route is uploaded at all.</p>
        <div class="btn-row">
          <a class="app-btn app-btn-soft" href="/privacy.html">Read the privacy notice</a>
          <button class="app-btn app-btn-danger" type="button" id="you-clear">Delete local history</button>
        </div>
      </div>
    </div>
  `;
}

function monthTrips(trips: Trip[]): Trip[] {
  const now = new Date();
  return trips.filter((trip) => {
    const at = new Date(trip.at);
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  });
}

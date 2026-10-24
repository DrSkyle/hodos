import "./styles.css";
import { clusterImpacts, hazardStatus, passedHazards, type ObservedImpact } from "@hodos/core";
import { deviceId, newTripId } from "./device";
import { HazardMap, severityLabel } from "./map";
import { CaptureSession, type SessionSnapshot } from "./session";
import { requestMotionAccess } from "./sensors";
import { appendEvent, listHazards, listSponsors, runAggregation, type HazardRecord, type Sponsor } from "./backend";
import { describeArea } from "./places";
import { formatDistance, loadMe, mergeMe, relativeTime, saveMe, spanDays, tally } from "./me";
import { establishSession, loadProfile, saveProfile } from "./account";
import type { TripRecord } from "./me";
import {
  automaticAvailable,
  automaticEnabled,
  pullAutomaticTrips,
  setAutomatic,
} from "./auto";
import {
  isValidCode,
  loadIdentity,
  newCode,
  normaliseCode,
  saveIdentity,
  type Identity,
} from "./identity";

function need<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

function reportRuntimeError(message: string): void {
  let banner = document.querySelector<HTMLElement>("#runtime-error");
  if (banner === null) {
    banner = document.createElement("div");
    banner.id = "runtime-error";
    banner.className = "runtime-error";
    document.body.appendChild(banner);
  }
  banner.textContent = `Something went wrong: ${message}`;
  banner.hidden = false;
}

window.addEventListener("error", (event) => reportRuntimeError(event.message));
window.addEventListener("unhandledrejection", (event) => reportRuntimeError(String(event.reason)));

const app = need<HTMLDivElement>("#app");

app.innerHTML = `
  <header class="bar">
    <button class="brand" data-view="map">
      <span class="glyph" aria-hidden="true"></span>
      <span class="brand-text">
        <strong>Hodos</strong>
        <em id="area-line">your neighbourhood</em>
      </span>
    </button>
    <nav class="tabs">
      <button data-view="map" class="tab is-active">Map</button>
      <button data-view="drive" class="tab">Drive</button>
      <button data-view="data" class="tab">Data</button>
      <button data-view="you" class="tab">You</button>
    </nav>
  </header>

  <main>
    <section data-panel="map" class="panel">
      <div class="map-wrap">
        <div id="map" class="map"></div>
        <div id="map-empty" class="empty-card" hidden>
          <p class="eyebrow">Your street</p>
          <h2>Nothing mapped here yet</h2>
          <p>Take a drive and Hodos starts filling this in. It only marks a hazard once a few phones have felt the same thing.</p>
          <button class="primary" data-view="drive">Start mapping</button>
        </div>
      </div>
      <aside class="sheet">
        <p class="eyebrow">Your neighbourhood</p>
        <h2 id="area-name">Locating you...</h2>
        <p id="area-sub" class="sub">Finding your street.</p>
        <div class="stats" id="map-stats"></div>
        <div class="row">
          <button id="locate" class="ghost">Find me</button>
          <button id="report" class="ghost">Road report</button>
        </div>
        <aside id="sponsor" class="sponsor" hidden></aside>
        <ul id="hazard-list" class="list"></ul>
      </aside>
    </section>

    <section data-panel="drive" class="panel">
      <div class="drive">
        <p class="eyebrow">Your drive</p>
        <h2 id="drive-title">Map a street</h2>
        <div id="auto-card" class="auto-card" hidden>
          <div class="auto-head">
            <div>
              <p class="eyebrow">Automatic</p>
              <h3 id="auto-title">Always mapping</h3>
            </div>
            <label class="switch">
              <input type="checkbox" id="auto-toggle" />
              <span class="slider"></span>
            </label>
          </div>
          <p id="auto-copy" class="sub"></p>
        </div>
        <p class="lede">
          Start a trip and keep this screen on while you travel. Hodos listens to the road
          and marks what it finds. You never file a report.
        </p>
        <button id="record" class="record">Start trip</button>
        <div class="stats big" id="drive-stats"></div>
        <p id="drive-status" class="status"></p>
        <div id="trip-result" class="result"></div>
      </div>
    </section>

    <section data-panel="data" class="panel">
      <div class="ledger">
        <header class="ledger-head">
          <p class="eyebrow">Open data</p>
          <h2>The ledger</h2>
          <p class="ledger-summary" id="data-summary">Reading the record.</p>
        </header>

        <div class="meters" id="data-meters" hidden>
          <div class="meter-row">
            <span class="meter-label">type</span>
            <span class="meter-text" id="meter-type"></span>
          </div>
          <div class="meter-row">
            <span class="meter-label">status</span>
            <div class="bar">
              <span class="seg seg-open" id="bar-open"></span>
              <span class="seg seg-repaired" id="bar-repaired"></span>
            </div>
            <span class="meter-fig" id="meter-status"></span>
          </div>
          <p class="legend">
            <span><i class="key key-minor"></i>minor</span>
            <span><i class="key key-moderate"></i>moderate</span>
            <span><i class="key key-severe"></i>severe</span>
          </p>
        </div>

        <div class="records-head">
          <span></span>
          <span>hazard</span>
          <span>evidence</span>
          <span>state</span>
          <span>conf.</span>
        </div>

        <ol class="records" id="data-records"></ol>
        <p class="ledger-empty" id="data-empty" hidden>
          The ledger is empty. The first trip will write the first line.
        </p>

        <footer class="ledger-foot">
          <button class="link" id="export-csv">Download CSV</button>
          <button class="link" id="export-json">Download JSON</button>
          <span class="foot-note">
            The map is free and always will be. If this goes to a road authority, name the
            ward so the source is on record.
          </span>
        </footer>      </div>
    </section>

    <section data-panel="you" class="panel">
      <div class="you">
        <p class="eyebrow">Yours</p>
        <h2 id="you-area">Your street</h2>
        <p id="you-sub" class="sub"></p>
        <div class="stats big" id="you-stats"></div>
        <h3 class="section-title">Your code</h3>
        <p class="sub" id="code-sub">
          Keep this. It is the only thing that brings your map back on a new phone.
        </p>
        <div class="code-row">
          <code id="code-value"></code>
          <button id="copy-code" class="ghost">Copy</button>
        </div>
        <details class="restore">
          <summary>Restore on another device</summary>
          <div class="restore-body">
            <input
              id="restore-input"
              autocomplete="off"
              spellcheck="false"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            />
            <button id="restore-go" class="ghost">Restore</button>
          </div>
          <p class="hint" id="restore-status"></p>
        </details>
        <h3 class="section-title">Recent trips</h3>
        <ul id="trip-list" class="list"></ul>
        <button id="report-you" class="ghost wide">Download road report</button>
        <section class="about">
          <h3 class="section-title">What Hodos is</h3>
          <p>Hodos turns the phones already travelling your streets into a road-condition
          sensor. A hazard reaches this map only after several independent passes from
          different phones agree on it, so what you see has been corroborated, not simply
          claimed.</p>
          <h3 class="section-title">Privacy</h3>
          <p>No accounts. The device identifier is random and rotates daily. Raw sensor
          traces never leave the phone &mdash; only the detected impact, placed on the road,
          is sent. The observation log is write-only.</p>
        </section>
      </div>
    </section>
  </main>

  <nav class="mobile-nav" aria-label="Sections">
    <button data-view="map" class="mnav is-active">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
      <span>Map</span>
    </button>
    <button data-view="drive" class="mnav">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 16l1.4-5.2A2 2 0 0 1 9.3 9.3h5.4a2 2 0 0 1 1.9 1.5L18 16" />
        <path d="M4.5 16h15v3.5h-3V18H7.5v1.5h-3z" />
      </svg>
      <span>Drive</span>
    </button>
    <button data-view="data" class="mnav">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 19v-7M12 19V5.5M18.5 19v-4.5" />
      </svg>
      <span>Data</span>
    </button>
    <button data-view="you" class="mnav">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8.4" r="3.2" />
        <path d="M5.5 19.6c0-3.3 2.9-5.6 6.5-5.6s6.5 2.3 6.5 5.6" />
      </svg>
      <span>You</span>
    </button>
  </nav>

  <div id="scrim" class="scrim" hidden></div>
  <article id="detail" class="detail" hidden></article>
`;

const hazardMap = new HazardMap(need<HTMLDivElement>("#map"), (record) => openDetail(record));
const areaLine = need<HTMLElement>("#area-line");
const areaName = need<HTMLElement>("#area-name");
const areaSub = need<HTMLElement>("#area-sub");
const mapStats = need<HTMLElement>("#map-stats");
const hazardList = need<HTMLUListElement>("#hazard-list");
const mapEmpty = need<HTMLElement>("#map-empty");
const driveStats = need<HTMLElement>("#drive-stats");
const driveStatus = need<HTMLElement>("#drive-status");
const driveTitle = need<HTMLElement>("#drive-title");
const tripResult = need<HTMLElement>("#trip-result");
const recordButton = need<HTMLButtonElement>("#record");
const youArea = need<HTMLElement>("#you-area");
const youSub = need<HTMLElement>("#you-sub");
const youStats = need<HTMLElement>("#you-stats");
const tripList = need<HTMLUListElement>("#trip-list");
const detail = need<HTMLElement>("#detail");
const scrim = need<HTMLElement>("#scrim");
const codeValue = need<HTMLElement>("#code-value");
const codeSub = need<HTMLElement>("#code-sub");
const copyCode = need<HTMLButtonElement>("#copy-code");
const restoreInput = need<HTMLInputElement>("#restore-input");
const restoreGo = need<HTMLButtonElement>("#restore-go");
const restoreStatus = need<HTMLElement>("#restore-status");
const autoCard = need<HTMLElement>("#auto-card");
const autoToggle = need<HTMLInputElement>("#auto-toggle");
const autoCopy = need<HTMLElement>("#auto-copy");
const dataSummary = need<HTMLElement>("#data-summary");
const dataMeters = need<HTMLElement>("#data-meters");
const dataList = need<HTMLElement>("#data-records");
const dataEmpty = need<HTMLElement>("#data-empty");
const sponsorSlot = need<HTMLElement>("#sponsor");
const meterType = need<HTMLElement>("#meter-type");
const meterStatus = need<HTMLElement>("#meter-status");
const barOpen = need<HTMLElement>("#bar-open");
const barRepaired = need<HTMLElement>("#bar-repaired");

function kindLabel(kind: string): string {
  return kind === "rough_pavement" ? "rough patch" : kind.replace("_", " ");
}

let me = loadMe();
let identity: Identity = loadIdentity() ?? { code: newCode() };
saveIdentity(identity);
let hazards: HazardRecord[] = [];
let session: CaptureSession | null = null;
let lastSnapshot: SessionSnapshot | null = null;
let currentRowId = "";

function switchView(view: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab, .mnav")) {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.classList.toggle("is-active", panel.dataset.panel === view);
  }
  if (location.hash.slice(1) !== view) {
    history.replaceState(null, "", `#${view}`);
  }
}

document.addEventListener("click", (event) => {
  const trigger = (event.target as HTMLElement).closest<HTMLElement>("[data-view]");
  if (trigger !== null && trigger.dataset.view !== undefined) {
    switchView(trigger.dataset.view);
  }
});

function stat(value: string | number, label: string, tone = ""): string {
  return `<div class="stat ${tone}"><span class="k">${value}</span><span class="v">${label}</span></div>`;
}

function renderMe(): void {
  const summary = tally(me);
  codeValue.textContent = identity.code;
  const where = me.area ?? "your neighbourhood";
  areaLine.textContent = where;
  areaName.textContent = me.area ?? "Your neighbourhood";
  areaSub.textContent =
    summary.trips === 0
      ? "You have not mapped a route yet. Everything you record stays yours."
      : `You have mapped ${summary.confirmed} confirmed ${summary.confirmed === 1 ? "hazard" : "hazards"} here.`;
  youArea.textContent = me.area ?? "Your street";
  youSub.textContent =
    summary.trips === 0
      ? "Nothing recorded yet."
      : `Last trip ${relativeTime(summary.lastTripAt)}.`;
  youStats.innerHTML = [
    stat(summary.trips, "trips"),
    stat(summary.impacts, "impacts felt"),
    stat(summary.confirmed, "hazards confirmed", "accent"),
    stat(formatDistance(summary.distanceM), "travelled"),
  ].join("");
  tripList.innerHTML =
    me.trips.length === 0
      ? `<li class="empty">Your trips will appear here, on this device only.</li>`
      : [...me.trips]
          .reverse()
          .slice(0, 12)
          .map(
            (trip) => `
        <li>
          <span class="sev sev-${trip.confirmed > 0 ? 1 : 2}">${relativeTime(trip.at)}</span>
          <span class="kind">${trip.impacts} impacts &middot; ${formatDistance(trip.distanceM)}</span>
          <span class="meta">${trip.confirmed} confirmed &middot; ${trip.locations} locations</span>
        </li>`,
          )
          .join("");
}

function renderHazards(): void {
  const published = hazards.filter((hazard) => hazard.published);
  const open = published.filter((hazard) => hazardStatus(hazard) === "open");
  hazardMap.setHazards(published);
  mapEmpty.hidden = published.length > 0;
  mapStats.innerHTML = [
    stat(open.length, "open"),
    stat(published.length - open.length, "fixed", "fixed"),
    stat(published.reduce((sum, hazard) => sum + hazard.deviceCount, 0), "phones"),
  ].join("");
  const ranked = [...published].sort(
    (a, b) =>
      Number(hazardStatus(a) === "fixed") - Number(hazardStatus(b) === "fixed") ||
      b.severity - a.severity ||
      b.confidence - a.confidence,
  );
  hazardList.innerHTML =
    ranked.length === 0
      ? `<li class="empty">No hazards confirmed yet.</li>`
      : ranked
          .slice(0, 60)
          .map((hazard) => {
            const status = hazardStatus(hazard);
            return `
        <li>
          <button class="list-item" data-row-id="${hazard.rowId}">
            <span class="sev sev-${hazard.severity}">${severityLabel(hazard.severity)}</span>
            <span class="kind">${hazard.kind.replace("_", " ")}${status === "fixed" ? ' <em class="tag-fixed">fixed</em>' : ""}</span>
            <span class="meta">${hazard.passCount} passes &middot; ${hazard.deviceCount} phones &middot; ${Math.round(hazard.confidence * 100)}%</span>
          </button>
        </li>`;
          })
          .join("");
}

hazardList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]");
  const rowId = button?.dataset.rowId;
  if (rowId === undefined) {
    return;
  }
  const record = hazards.find((hazard) => hazard.rowId === rowId);
  if (record !== undefined) {
    hazardMap.focus(record.lat, record.lng);
    openDetail(record);
  }
});

const SPONSOR_KEY = "hodos.sponsor.dismissed";
let sponsors: Sponsor[] = [];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    character === "&"
      ? "&amp;"
      : character === "<"
        ? "&lt;"
        : character === ">"
          ? "&gt;"
          : character === '"'
            ? "&quot;"
            : "&#39;",
  );
}

function renderSponsor(): void {
  const sponsor = sponsors[0];
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(SPONSOR_KEY) === "1";
  } catch {
    dismissed = false;
  }
  if (sponsor === undefined || dismissed) {
    sponsorSlot.hidden = true;
    return;
  }
  sponsorSlot.hidden = false;
  sponsorSlot.innerHTML = `
    <span class="sponsor-tag">Sponsored</span>
    <button class="sponsor-close" data-sponsor-dismiss aria-label="Hide">&#10005;</button>
    <strong>${escapeHtml(sponsor.name)}</strong>
    ${sponsor.line === "" ? "" : `<span>${escapeHtml(sponsor.line)}</span>`}
    ${
      sponsor.url === ""
        ? ""
        : `<a class="sponsor-link" href="${escapeHtml(sponsor.url)}" target="_blank" rel="noopener noreferrer">Visit</a>`
    }
  `;
}

sponsorSlot.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-sponsor-dismiss]") === null) {
    return;
  }
  try {
    localStorage.setItem(SPONSOR_KEY, "1");
  } catch {
    /* ignore */
  }
  sponsorSlot.hidden = true;
});

async function loadSponsors(): Promise<void> {
  sponsors = await listSponsors();
  renderSponsor();
}

const DATA_COLUMNS = [
  "hazardId",
  "kind",
  "severity",
  "status",
  "lat",
  "lng",
  "passCount",
  "deviceCount",
  "dayCount",
  "confidence",
  "clearPasses",
  "fixedVotes",
  "firstSeen",
  "lastSeen",
] as const;

function rankedHazards(): HazardRecord[] {
  return [...hazards].sort(
    (a, b) => Number(hazardStatus(a) === "fixed") - Number(hazardStatus(b) === "fixed") || b.severity - a.severity,
  );
}

function renderData(): void {
  const all = hazards;
  const repaired = all.filter((hazard) => hazardStatus(hazard) === "fixed").length;
  const open = all.length - repaired;
  const count = (kind: string) => all.filter((hazard) => hazard.kind === kind).length;
  const potholes = count("pothole");
  const bumps = count("speed_bump");
  const rough = count("rough_pavement");

  dataSummary.textContent =
    all.length === 0
      ? "Nothing yet. The first trip writes the first line."
      : `${all.length} ${all.length === 1 ? "hazard" : "hazards"} on record · ${open} still open · ${repaired} repaired`;

  dataMeters.hidden = all.length === 0;
  const share = (value: number) => `${all.length === 0 ? 0 : (value / all.length) * 100}%`;
  barOpen.style.width = share(open);
  barRepaired.style.width = share(repaired);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  meterType.textContent = `${plural(potholes, "pothole", "potholes")} · ${plural(bumps, "speed bump", "speed bumps")} · ${plural(rough, "rough patch", "rough patches")}`;
  meterStatus.textContent = `${open} open · ${repaired} repaired`;

  dataEmpty.hidden = all.length > 0;
  dataList.innerHTML = rankedHazards()
    .map((hazard) => {
      const status = hazardStatus(hazard);
      const mark =
        status === "fixed" ? (hazard.fixedVotes >= 2 ? "reported fixed" : "repaired") : "open";
      return `
        <li class="record" data-row-id="${hazard.rowId}">
          <i class="pip sev-${hazard.severity}"></i>
          <span class="record-kind">${kindLabel(hazard.kind)}</span>
          <span class="record-meta">${hazard.passCount} ${hazard.passCount === 1 ? "pass" : "passes"} · ${hazard.deviceCount} ${hazard.deviceCount === 1 ? "phone" : "phones"} · ${hazard.dayCount} ${hazard.dayCount === 1 ? "day" : "days"}</span>
          <span class="record-mark ${status === "fixed" ? "is-repaired" : "is-open"}">${mark}</span>
          <span class="record-conf">${Math.round(hazard.confidence * 100)}<small>%</small></span>
        </li>`;
    })
    .join("");
}

dataList.addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]");
  const rowId = row?.dataset.rowId;
  if (rowId === undefined) {
    return;
  }
  const record = hazards.find((hazard) => hazard.rowId === rowId);
  if (record === undefined) {
    return;
  }
  switchView("map");
  hazardMap.focus(record.lat, record.lng);
  openDetail(record);
});

interface HazardRow extends Record<string, string | number> {
  hazardId: string;
}

function dataRecords(): HazardRow[] {
  return rankedHazards().map((hazard) => ({
    hazardId: hazard.id,
    kind: hazard.kind,
    severity: hazard.severity,
    status: hazardStatus(hazard),
    lat: Number(hazard.lat.toFixed(6)),
    lng: Number(hazard.lng.toFixed(6)),
    passCount: hazard.passCount,
    deviceCount: hazard.deviceCount,
    dayCount: hazard.dayCount,
    confidence: hazard.confidence,
    clearPasses: hazard.clearPasses,
    fixedVotes: hazard.fixedVotes,
    firstSeen: new Date(hazard.firstSeen).toISOString(),
    lastSeen: new Date(hazard.lastSeen).toISOString(),
  }));
}

function saveFile(name: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: HazardRow[]): string {
  const header = DATA_COLUMNS.join(",");
  const lines = rows.map((row) =>
    DATA_COLUMNS.map((key) => {
      const value = String(row[key] ?? "");
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(","),
  );
  return [header, ...lines].join("\n");
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

need<HTMLButtonElement>("#export-csv").addEventListener("click", () => {
  saveFile(`hodos-hazards-${stamp()}.csv`, "text/csv", toCsv(dataRecords()));
});

need<HTMLButtonElement>("#export-json").addEventListener("click", () => {
  const payload = {
    dataset: "hodos.hazards.v1",
    generatedAt: new Date().toISOString(),
    fields: {
      hazardId: "stable id, rounded coordinate pair",
      kind: "pothole | speed_bump | rough_pavement",
      severity: "1 minor, 2 moderate, 3 severe (speed-normalised)",
      status: "open | fixed",
      passCount: "impacts that corroborate this hazard",
      deviceCount: "distinct anonymous devices",
      dayCount: "distinct calendar days observed",
      confidence: "0..1, blends passes, devices, detection quality and recency",
      clearPasses: "silent passes since the last impact",
      fixedVotes: "distinct devices reporting it repaired",
      firstSeen: "ISO 8601",
      lastSeen: "ISO 8601",
    },
    records: dataRecords(),
  };
  saveFile(`hodos-hazards-${stamp()}.json`, "application/json", JSON.stringify(payload, null, 2));
});

function openDetail(record: HazardRecord): void {
  currentRowId = record.rowId;
  const status = hazardStatus(record);
  const days = spanDays(record.firstSeen, record.lastSeen);
  detail.innerHTML = `
    <header class="detail-head">
      <span class="sev sev-${record.severity}">${severityLabel(record.severity)}</span>
      <h3>${record.kind.replace("_", " ")}</h3>
      <button class="icon" data-close aria-label="Close">&#10005;</button>
    </header>
    <dl class="facts">
      <div><dt>Confirmed by</dt><dd>${record.passCount} passes from ${record.deviceCount} ${record.deviceCount === 1 ? "phone" : "phones"}</dd></div>
      <div><dt>First seen</dt><dd>${relativeTime(record.firstSeen)}</dd></div>
      <div><dt>Last seen</dt><dd>${relativeTime(record.lastSeen)}</dd></div>
      <div><dt>Visible for</dt><dd>${days} ${days === 1 ? "day" : "days"}</dd></div>
      <div><dt>Confidence</dt><dd>${Math.round(record.confidence * 100)}%</dd></div>
      ${
        record.clearPasses > 0
          ? `<div><dt>Travelled since, felt nothing</dt><dd>${record.clearPasses} ${record.clearPasses === 1 ? "phone" : "phones"}</dd></div>`
          : ""
      }
      <div><dt>Status</dt><dd>${status === "fixed" ? (record.fixedVotes >= 2 ? "Reported fixed" : "Looks repaired") : "Open"}</dd></div>
    </dl>
    <div class="detail-actions">
      <button class="ghost" data-action="confirm">Still there</button>
      <button class="ghost danger" data-action="fix" ${status === "fixed" ? "disabled" : ""}>Fixed now</button>
    </div>
    <p class="hint">Your answer updates the map for everyone.</p>
  `;
  openSheet();
}

function openReport(): void {
  currentRowId = "";
  const published = hazards.filter((hazard) => hazard.published);
  const open = published.filter((hazard) => hazardStatus(hazard) === "open");
  const area = me.area ?? "Your neighbourhood";
  const lines = [
    `Road report — ${area}`,
    `Generated ${new Date().toISOString().slice(0, 10)} with Hodos`,
    "",
    `${open.length} open ${open.length === 1 ? "hazard" : "hazards"} of ${published.length} mapped, from ${published.reduce((sum, h) => sum + h.passCount, 0)} independent passes.`,
    "",
    "Severity | Type | Passes | Phones | Confidence | Latitude | Longitude",
    ...open
      .sort((a, b) => b.severity - a.severity)
      .map(
        (h) =>
          `${severityLabel(h.severity)} | ${h.kind.replace("_", " ")} | ${h.passCount} | ${h.deviceCount} | ${Math.round(h.confidence * 100)}% | ${h.lat.toFixed(6)} | ${h.lng.toFixed(6)}`,
      ),
    "",
    "Each hazard was detected passively and confirmed by independent passes.",
  ];
  const text = lines.join("\n");
  detail.innerHTML = `
    <header class="detail-head">
      <h3>Road report</h3>
      <button class="icon" data-close aria-label="Close">&#10005;</button>
    </header>
    <pre class="report">${text.replace(/</g, "&lt;")}</pre>
    <div class="detail-actions">
      <button class="ghost" data-action="download">Download</button>
      <button class="ghost" data-action="share">Share</button>
    </div>
  `;
  detail.dataset.report = text;
  openSheet();
}

function openSheet(): void {
  scrim.hidden = false;
  detail.hidden = false;
  requestAnimationFrame(() => detail.classList.add("is-open"));
}

function closeSheet(): void {
  detail.classList.remove("is-open");
  scrim.hidden = true;
  window.setTimeout(() => {
    detail.hidden = true;
    delete detail.dataset.report;
  }, 180);
}

scrim.addEventListener("click", closeSheet);

detail.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-close]") !== null) {
    closeSheet();
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  const rowId = currentRowId === "" ? undefined : currentRowId;
  if (action === "download") {
    downloadReport(detail.dataset.report ?? "");
    return;
  }
  if (action === "share") {
    void shareReport(detail.dataset.report ?? "");
    return;
  }
  if (rowId === undefined || action === undefined) {
    return;
  }
  if (action === "confirm") {
    void recordConfirmation(rowId);
  } else if (action === "fix") {
    void recordFix(rowId);
  }
  closeSheet();
});

async function recordConfirmation(rowId: string): Promise<void> {
  const hazard = hazards.find((candidate) => candidate.rowId === rowId);
  if (hazard === undefined) {
    return;
  }
  try {
    await appendEvent({
      deviceId: deviceId(),
      tripId: newTripId(),
      recordedAt: new Date().toISOString(),
      lat: hazard.lat,
      lng: hazard.lng,
      accuracy: 6,
      speedKph: 0,
      magnitude: 0,
      severity: hazard.severity,
      kind: hazard.kind,
      confidence: 0.9,
      mode: "vehicle",
      hazardRef: rowId,
    });
    await runAggregation();
    window.setTimeout(() => void refreshHazards(), 2500);
  } catch {
    /* the report is best effort */
  }
}

async function recordFix(rowId: string): Promise<void> {
  const hazard = hazards.find((candidate) => candidate.rowId === rowId);
  if (hazard === undefined) {
    return;
  }
  try {
    await appendEvent({
      deviceId: deviceId(),
      tripId: newTripId(),
      recordedAt: new Date().toISOString(),
      lat: hazard.lat,
      lng: hazard.lng,
      accuracy: 6,
      speedKph: 0,
      magnitude: 0,
      severity: 1,
      kind: hazard.kind,
      confidence: 0.9,
      mode: "vehicle",
      observation: "fix",
      hazardRef: rowId,
    });
    await runAggregation();
    window.setTimeout(() => void refreshHazards(), 2500);
  } catch {
    /* the report is best effort */
  }
}

function downloadReport(text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hodos-report-${new Date().toISOString().slice(0, 10)}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function shareReport(text: string): Promise<void> {
  if (navigator.share !== undefined) {
    try {
      await navigator.share({ title: "Hodos road report", text });
      return;
    } catch {
      /* fall through to download */
    }
  }
  downloadReport(text);
}

async function refreshHazards(): Promise<void> {
  try {
    hazards = await listHazards();
    renderHazards();
    renderData();
    if (!detail.hidden && currentRowId !== "") {
      const fresh = hazards.find((hazard) => hazard.rowId === currentRowId);
      if (fresh !== undefined) {
        openDetail(fresh);
      }
    }
  } catch (error) {
    driveStatus.textContent = `Could not reach the map service: ${(error as Error).message}`;
  }
}

function renderDrive(snapshot: SessionSnapshot): void {
  lastSnapshot = snapshot;
  hazardMap.setTripImpacts(snapshot.impacts);
  if (snapshot.lastFix !== null) {
    hazardMap.setUserPosition(snapshot.lastFix.lat, snapshot.lastFix.lng);
  }
  driveStats.innerHTML = [
    stat(snapshot.impacts.length, "impacts"),
    stat(snapshot.speedKph === null ? "—" : Math.round(snapshot.speedKph), "km/h"),
    stat(formatDistance(snapshot.travelledM), "travelled"),
  ].join("");
  if (snapshot.stalled) {
    driveStatus.textContent =
      "This phone is not reporting movement yet. Check motion and location access for Hodos.";
  }
}

async function locate(): Promise<void> {
  if (!("geolocation" in navigator)) {
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      hazardMap.setUserPosition(latitude, longitude);
      hazardMap.focus(latitude, longitude);
      me.centre = { lat: latitude, lng: longitude };
      saveMe(me);
      void describeArea(latitude, longitude).then((name) => {
        if (name !== null) {
          me.area = name;
          saveMe(me);
          renderMe();
        }
      });
    },
    () => {
      /* location refused or unavailable */
    },
    { enableHighAccuracy: true, timeout: 10_000 },
  );
}

async function startTrip(): Promise<void> {
  const granted = await requestMotionAccess();
  if (!granted) {
    driveStatus.textContent =
      "Motion access was refused. Grant it in the browser or system settings, then try again.";
    return;
  }
  tripResult.innerHTML = "";
  driveTitle.textContent = "Recording";
  driveStatus.textContent = "Recording. Keep this screen open while you travel.";
  session = new CaptureSession(renderDrive);
  await session.start();
  recordButton.textContent = "End trip";
  recordButton.classList.add("is-recording");
}

async function endTrip(): Promise<void> {
  if (session === null) {
    return;
  }
  const track = session.getTrack();
  const impacts = await session.stop();
  session = null;
  recordButton.textContent = "Start trip";
  recordButton.classList.remove("is-recording");
  driveTitle.textContent = "Map a route";
  driveStatus.textContent = "Saving your contributions...";

  const id = deviceId();
  const trip = newTripId();
  let uploaded = 0;
  for (const impact of impacts) {
    try {
      await appendEvent({
        deviceId: id,
        tripId: trip,
        recordedAt: new Date(impact.t).toISOString(),
        lat: impact.lat,
        lng: impact.lng,
        accuracy: impact.accuracy,
        speedKph: Number(impact.speedKph.toFixed(1)),
        magnitude: impact.magnitude,
        severity: impact.severity,
        kind: impact.kind,
        confidence: impact.confidence,
        mode: impact.mode,
      });
      uploaded += 1;
    } catch {
      /* a single failed upload must not lose the rest */
    }
  }

  const observed: ObservedImpact[] = impacts.map((impact) => ({ ...impact, deviceId: id }));
  const clusters = clusterImpacts(observed, { now: Date.now() });

  const confirmed = clusters.filter((hazard) => hazard.published).length;

  // Evidence in the other direction: hazards this trip went past without
  // feeling. That is what lets a repaired road drop off the map by itself.
  const known = hazards.filter((hazard) => hazard.published);
  const cleared = passedHazards(track, known, impacts);
  for (const hazard of cleared) {
    try {
      await appendEvent({
        deviceId: id,
        tripId: trip,
        recordedAt: new Date().toISOString(),
        lat: hazard.lat,
        lng: hazard.lng,
        accuracy: 6,
        speedKph: 0,
        magnitude: 0,
        severity: 1,
        kind: hazard.kind,
        confidence: 0.8,
        mode: "vehicle",
        observation: "pass",
        hazardRef: hazard.rowId,
      });
    } catch {
      /* a missed pass must not fail the trip */
    }
  }
  await runAggregation();
  const travelledM = lastSnapshot?.travelledM ?? 0;
  const lastFix = lastSnapshot?.lastFix ?? null;
  me.trips.push({
    at: Date.now(),
    impacts: impacts.length,
    locations: clusters.length,
    confirmed,
    distanceM: travelledM,
  });
  if (lastFix !== null) {
    me.centre = { lat: lastFix.lat, lng: lastFix.lng };
  }
  saveMe(me);
  renderMe();
  void saveProfile(JSON.stringify(me));

  driveStatus.textContent = "";
  tripResult.innerHTML = `
    <p><strong>${impacts.length}</strong> impacts felt over <strong>${formatDistance(travelledM)}</strong>.
    <strong>${clusters.length}</strong> road locations updated, <strong>${confirmed}</strong> now confirmed on the map.</p>
  `;
  await refreshHazards();
  window.setTimeout(() => void refreshHazards(), 2500);
}

recordButton.addEventListener("click", () => {
  if (session === null) {
    void startTrip();
  } else {
    void endTrip();
  }
});

need<HTMLButtonElement>("#locate").addEventListener("click", () => void locate());
need<HTMLButtonElement>("#report").addEventListener("click", openReport);
need<HTMLButtonElement>("#report-you").addEventListener("click", openReport);

if (me.centre !== null) {
  hazardMap.centreOn(me.centre.lat, me.centre.lng);
}

async function renderAutomatic(): Promise<void> {
  if (!automaticAvailable()) {
    autoCard.hidden = true;
    return;
  }
  autoCard.hidden = false;
  const on = await automaticEnabled();
  autoToggle.checked = on;
  autoCopy.textContent = on
    ? "On. It starts when you set off and stops when you park. Keep location on \u201cAllow all the time\u201d."
    : "Turn this on once. After that it runs by itself whenever you drive.";
}

autoToggle.addEventListener("change", () => {
  const wanted = autoToggle.checked;
  autoToggle.disabled = true;
  autoCopy.textContent = wanted ? "Turning on..." : "Turning off...";
  void setAutomatic(wanted).then((result) => {
    autoToggle.checked = result.enabled;
    autoToggle.disabled = false;
    if (result.error !== undefined) {
      autoCopy.textContent = `Could not turn it on: ${result.error}`;
      return;
    }
    void renderAutomatic();
  });
});

async function mergeAutomaticTrips(): Promise<void> {
  const trips = await pullAutomaticTrips();
  if (trips.length === 0) {
    return;
  }
  const seen = new Set(me.trips.map((trip) => trip.at));
  let added = 0;
  for (const trip of trips) {
    if (!seen.has(trip.at)) {
      me.trips.push(trip);
      seen.add(trip.at);
      added += 1;
    }
  }
  if (added === 0) {
    return;
  }
  me.trips.sort((a, b) => a.at - b.at);
  saveMe(me);
  renderMe();
  void saveProfile(JSON.stringify(me));
}

async function bootstrapIdentity(): Promise<void> {
  const ok = await establishSession(identity.code);
  if (!ok) {
    codeSub.textContent =
      "Your code is saved on this phone. It will sync the next time this device is online.";
    return;
  }
  const remote = await loadProfile();
  if (remote !== null) {
    try {
      me = mergeMe(me, JSON.parse(remote) as typeof me);
      saveMe(me);
      renderMe();
    } catch {
      /* an unreadable profile must not lose the local one */
    }
  }
  void saveProfile(JSON.stringify(me));
  await mergeAutomaticTrips();
}

copyCode.addEventListener("click", () => {
  void navigator.clipboard
    ?.writeText(identity.code)
    .then(() => {
      copyCode.textContent = "Copied";
      window.setTimeout(() => {
        copyCode.textContent = "Copy";
      }, 1500);
    })
    .catch(() => {
      copyCode.textContent = "Select it";
    });
});

restoreGo.addEventListener("click", () => {
  const candidate = normaliseCode(restoreInput.value);
  if (!isValidCode(candidate)) {
    restoreStatus.textContent = "That code is not the right shape.";
    return;
  }
  restoreStatus.textContent = "Restoring...";
  void establishSession(candidate).then(async (ok) => {
    if (!ok) {
      restoreStatus.textContent = "Could not restore that code.";
      return;
    }
    identity = { code: candidate };
    saveIdentity(identity);
    const remote = await loadProfile();
    if (remote !== null) {
      try {
        me = mergeMe(me, JSON.parse(remote) as typeof me);
      } catch {
        /* ignore malformed remote copy */
      }
    }
    saveMe(me);
    renderMe();
    restoreStatus.textContent = "Restored.";
  });
});

renderMe();
renderData();
void refreshHazards();
void loadSponsors();
const initialView = location.hash.replace("#", "");
if (["map", "drive", "data", "you"].includes(initialView)) {
  switchView(initialView);
}
void bootstrapIdentity();
void renderAutomatic();
if (me.centre === null) {
  void locate();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

import "./styles.css";
import { clusterImpacts, hazardStatus, type ObservedImpact } from "@hodos/core";
import { deviceId, newTripId, rowIdFor } from "./device";
import { HazardMap, severityLabel } from "./map";
import { CaptureSession, type SessionSnapshot } from "./session";
import { requestMotionAccess } from "./sensors";
import {
  appendEvent,
  confirmHazard,
  listHazards,
  markFixed,
  upsertHazard,
  type HazardRecord,
} from "./backend";
import { describeArea } from "./places";
import { formatDistance, loadMe, relativeTime, saveMe, spanDays, tally } from "./me";

function need<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

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
      <button data-view="you" class="tab">You</button>
    </nav>
  </header>

  <main>
    <section data-panel="map" class="panel">
      <div class="map-wrap">
        <div id="map" class="map"></div>
        <div id="map-empty" class="empty-card" hidden>
          <p class="eyebrow">Nothing confirmed here yet</p>
          <h2>Be the first on your street</h2>
          <p>Hodos wants three passes from two phones before it puts a hazard on the map. Take the first one.</p>
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
        <ul id="hazard-list" class="list"></ul>
      </aside>
    </section>

    <section data-panel="drive" class="panel">
      <div class="drive">
        <p class="eyebrow">Recording</p>
        <h2 id="drive-title">Map a route</h2>
        <p class="lede">
          Mount your phone so it sits flat and steady, then travel your normal route.
          Keep this screen open &mdash; the browser will not sense in the background.
          You never file a report.
        </p>
        <button id="record" class="record">Start trip</button>
        <div class="stats big" id="drive-stats"></div>
        <p id="drive-status" class="status"></p>
        <div id="trip-result" class="result"></div>
      </div>
    </section>

    <section data-panel="you" class="panel">
      <div class="you">
        <p class="eyebrow">Yours</p>
        <h2 id="you-area">Your street</h2>
        <p id="you-sub" class="sub"></p>
        <div class="stats big" id="you-stats"></div>
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

let me = loadMe();
let hazards: HazardRecord[] = [];
let session: CaptureSession | null = null;
let lastSnapshot: SessionSnapshot | null = null;
let currentRowId = "";

function switchView(view: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.classList.toggle("is-active", panel.dataset.panel === view);
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
      <div><dt>Status</dt><dd>${status === "fixed" ? "Reported fixed" : "Open"}</dd></div>
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
    void confirmHazard(rowId).then(refreshHazards);
  } else if (action === "fix") {
    void markFixed(rowId).then(refreshHazards);
  }
  closeSheet();
});

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
      });
      uploaded += 1;
    } catch {
      /* a single failed upload must not lose the rest */
    }
  }

  const observed: ObservedImpact[] = impacts.map((impact) => ({ ...impact, deviceId: id }));
  const clusters = clusterImpacts(observed, { now: Date.now() });
  for (const hazard of clusters) {
    try {
      await upsertHazard({ rowId: rowIdFor(hazard.lat, hazard.lng), hazard });
    } catch {
      /* best-effort merge */
    }
  }

  const confirmed = clusters.filter((hazard) => hazard.published).length;
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

  driveStatus.textContent = "";
  tripResult.innerHTML = `
    <p><strong>${impacts.length}</strong> impacts felt over <strong>${formatDistance(travelledM)}</strong>.
    <strong>${clusters.length}</strong> road locations updated, <strong>${confirmed}</strong> now confirmed on the map.</p>
  `;
  await refreshHazards();
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

renderMe();
void refreshHazards();
if (me.centre === null) {
  void locate();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

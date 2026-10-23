import "./styles.css";
import { clusterImpacts, type ObservedImpact } from "@hodos/core";
import { deviceId, newTripId, rowIdFor } from "./device";
import { HazardMap, severityLabel } from "./map";
import { CaptureSession, type SessionSnapshot } from "./session";
import { requestMotionAccess } from "./sensors";
import { appendEvent, listHazards, upsertHazard, type HazardRecord } from "./backend";

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) {
  throw new Error("missing #app");
}

app.innerHTML = `
  <header class="bar">
    <div class="wordmark">
      <span class="dot"></span>
      <h1>Hodos</h1>
    </div>
    <nav class="tabs">
      <button data-view="map" class="tab is-active">Map</button>
      <button data-view="drive" class="tab">Drive</button>
      <button data-view="about" class="tab">About</button>
    </nav>
  </header>

  <main>
    <section data-panel="map" class="panel is-active">
      <div id="map" class="map"></div>
      <aside class="sheet">
        <div class="stats" id="map-stats"></div>
        <div class="row">
          <button id="locate" class="ghost">My location</button>
          <button id="export" class="ghost">Export report</button>
        </div>
        <ul id="hazard-list" class="list"></ul>
      </aside>
    </section>

    <section data-panel="drive" class="panel">
      <div class="drive">
        <p class="lede">
          Mount your phone, tap start, and drive. Hodos reads the road from the
          motion sensors, works out where the potholes are, and adds them to the
          map. You never file a report.
        </p>
        <button id="record" class="record">Start trip</button>
        <div class="stats big" id="drive-stats"></div>
        <p id="drive-status" class="status"></p>
        <div id="trip-result" class="result"></div>
      </div>
    </section>

    <section data-panel="about" class="panel">
      <div class="about">
        <h2>What Hodos is</h2>
        <p>
          Hodos turns the phones already travelling your streets into a road-condition
          sensor. Impacts are detected on-device; a hazard only appears on the public
          map once several independent passes corroborate it.
        </p>
        <h2>Privacy</h2>
        <p>
          No accounts. The device identifier is random and rotates daily. Raw sensor
          traces never leave the phone &mdash; only the detected impact, coarsened to the
          road, is sent. The observation log is write-only; nobody can read the raw
          traces back out.
        </p>
        <h2>What it is not</h2>
        <p>
          Hodos reads potholes, speed bumps and rough pavement. It is a map, not a
          substitute for a road authority.
        </p>
      </div>
    </section>
  </main>
`;

const hazardMap = new HazardMap(document.querySelector<HTMLDivElement>("#map") as HTMLElement);

const mapStats = document.querySelector<HTMLDivElement>("#map-stats");
const hazardList = document.querySelector<HTMLUListElement>("#hazard-list");
const driveStats = document.querySelector<HTMLDivElement>("#drive-stats");
const driveStatus = document.querySelector<HTMLParagraphElement>("#drive-status");
const tripResult = document.querySelector<HTMLDivElement>("#trip-result");
const recordButton = document.querySelector<HTMLButtonElement>("#record");

let hazards: HazardRecord[] = [];
let session: CaptureSession | null = null;

function switchView(view: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.classList.toggle("is-active", panel.dataset.panel === view);
  }
}

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => switchView(tab.dataset.view ?? "map"));
}

function renderHazards(): void {
  const published = hazards.filter((hazard) => hazard.published);
  hazardMap.setHazards(published);
  if (mapStats !== null) {
    mapStats.innerHTML = `
      <div class="stat"><span class="k">${published.length}</span><span class="v">mapped</span></div>
      <div class="stat"><span class="k">${published.reduce((sum, h) => sum + h.passCount, 0)}</span><span class="v">passes</span></div>
      <div class="stat"><span class="k">${published.reduce((sum, h) => sum + h.deviceCount, 0)}</span><span class="v">devices</span></div>
    `;
  }
  if (hazardList === null) {
    return;
  }
  const ranked = [...published].sort((a, b) => b.severity - a.severity || b.confidence - a.confidence);
  hazardList.innerHTML =
    ranked.length === 0
      ? `<li class="empty">No hazards confirmed yet. Drive a route to contribute.</li>`
      : ranked
          .slice(0, 50)
          .map(
            (hazard) => `
        <li>
          <span class="sev sev-${hazard.severity}">${severityLabel(hazard.severity)}</span>
          <span class="kind">${hazard.kind.replace("_", " ")}</span>
          <span class="meta">${hazard.passCount} passes &middot; ${Math.round(hazard.confidence * 100)}%</span>
        </li>`,
          )
          .join("");
}

async function refreshHazards(): Promise<void> {
  try {
    hazards = await listHazards();
    renderHazards();
  } catch (error) {
    if (driveStatus !== null) {
      driveStatus.textContent = `Could not reach the map service: ${(error as Error).message}`;
    }
  }
}

function renderDrive(snapshot: SessionSnapshot): void {
  hazardMap.setTripImpacts(snapshot.impacts);
  if (snapshot.lastFix !== null) {
    hazardMap.setUserPosition(snapshot.lastFix.lat, snapshot.lastFix.lng);
  }
  if (driveStats !== null) {
    driveStats.innerHTML = `
      <div class="stat"><span class="k">${snapshot.impacts.length}</span><span class="v">impacts</span></div>
      <div class="stat"><span class="k">${snapshot.speedKph === null ? "-" : Math.round(snapshot.speedKph)}</span><span class="v">km/h</span></div>
      <div class="stat"><span class="k">${snapshot.accuracy === null ? "-" : Math.round(snapshot.accuracy)}</span><span class="v">m accuracy</span></div>
    `;
  }
}

async function startTrip(): Promise<void> {
  if (recordButton === null) {
    return;
  }
  const granted = await requestMotionAccess();
  if (!granted) {
    if (driveStatus !== null) {
      driveStatus.textContent =
        "Motion access was refused. Grant it in the browser or system settings and try again.";
    }
    return;
  }
  if (tripResult !== null) {
    tripResult.innerHTML = "";
  }
  if (driveStatus !== null) {
    driveStatus.textContent = "Recording. Keep this screen open while you travel.";
  }
  session = new CaptureSession(renderDrive);
  await session.start();
  recordButton.textContent = "End trip";
  recordButton.classList.add("is-recording");
}

async function endTrip(): Promise<void> {
  if (recordButton === null || session === null) {
    return;
  }
  const impacts = await session.stop();
  session = null;
  recordButton.textContent = "Start trip";
  recordButton.classList.remove("is-recording");
  if (driveStatus !== null) {
    driveStatus.textContent = "Saving your contributions...";
  }

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

  if (driveStatus !== null) {
    driveStatus.textContent = "";
  }
  if (tripResult !== null) {
    const confirming = clusters.filter((hazard) => hazard.published).length;
    tripResult.innerHTML = `
      <p><strong>${impacts.length}</strong> impacts detected, <strong>${uploaded}</strong> logged,
      <strong>${clusters.length}</strong> road locations updated, <strong>${confirming}</strong> now confirmed on the public map.</p>
    `;
  }
  await refreshHazards();
}

recordButton?.addEventListener("click", () => {
  if (session === null) {
    void startTrip();
  } else {
    void endTrip();
  }
});

document.querySelector<HTMLButtonElement>("#locate")?.addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      hazardMap.setUserPosition(position.coords.latitude, position.coords.longitude);
      hazardMap.focus(position.coords.latitude, position.coords.longitude);
    },
    () => {
      /* location refused */
    },
  );
});

function buildReport(): string {
  const published = hazards.filter((hazard) => hazard.published);
  const lines = [
    "# Hodos road hazard report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Hazards: ${published.length}`,
    "",
    "| Severity | Kind | Passes | Devices | Confidence | Latitude | Longitude |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...published
      .sort((a, b) => b.severity - a.severity)
      .map(
        (h) =>
          `| ${severityLabel(h.severity)} | ${h.kind.replace("_", " ")} | ${h.passCount} | ${h.deviceCount} | ${Math.round(h.confidence * 100)}% | ${h.lat.toFixed(6)} | ${h.lng.toFixed(6)} |`,
      ),
    "",
    "Hazards are confirmed by independent passes, each detected on-device.",
  ];
  return lines.join("\n");
}

document.querySelector<HTMLButtonElement>("#export")?.addEventListener("click", () => {
  const blob = new Blob([buildReport()], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hodos-report-${new Date().toISOString().slice(0, 10)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
});

void refreshHazards();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

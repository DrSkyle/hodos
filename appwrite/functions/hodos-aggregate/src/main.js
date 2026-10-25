/**
 * Hodos aggregation.
 *
 * The single writer of the public map. It reads the immutable event log and
 * derives every hazard from it, so corroboration is exact and no two clients
 * can race each other out of a count. Runs on a schedule, and can also be
 * triggered by the app at the end of a trip.
 */

const ENDPOINT =
  process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;

const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";
const LOOKBACK_DAYS = Number(process.env.HODOS_LOOKBACK_DAYS || 120);
const PAGE_SIZE = 500;
const MAX_EVENTS = 20000;

const MERGE_DISTANCE_M = 15;
const PUBLISH_MIN_PASSES = 3;
const PUBLISH_MIN_DEVICES = 2;
const HALF_LIFE_DAYS = 90;
const MS_PER_DAY = 86400000;

function headers() {
  return {
    "X-Appwrite-Project": PROJECT,
    "X-Appwrite-Key": KEY,
    "Content-Type": "application/json",
  };
}

function rowsUrl(table) {
  return `${ENDPOINT}/tablesdb/${DATABASE_ID}/tables/${table}/rows`;
}

function haversine(a, b) {
  const earth = 6371008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function fetchEvents(sinceIso) {
  const events = [];
  let offset = 0;
  while (events.length < MAX_EVENTS) {
    const queries = [
      JSON.stringify({ method: "greaterThan", attribute: "recordedAt", values: [sinceIso] }),
      JSON.stringify({ method: "orderDesc", attribute: "recordedAt" }),
      JSON.stringify({ method: "limit", values: [PAGE_SIZE] }),
      JSON.stringify({ method: "offset", values: [offset] }),
    ];
    const url = `${rowsUrl("events")}?${queries.map((q) => `queries[]=${encodeURIComponent(q)}`).join("&")}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      throw new Error(`events read failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.rows)) {
      throw new Error("invalid events response: rows array required");
    }
    const rows = body.rows;
    events.push(...rows);
    if (rows.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }
  return events;
}

/** Reject malformed or out-of-window observations before spatial aggregation. */
function validEvent(event, sinceMs, now) {
  if (!event || typeof event !== "object") return false;
  // Enforce the wire format, not coercions like Number(null) === 0.
  // All native reports send JSON numbers; legacy rows may omit confidence.
  const { lat, lng, accuracy, severity, speedKph, magnitude } = event;
  const time = typeof event.recordedAt === "string"
    ? Date.parse(event.recordedAt) : NaN;
  const confidence = event.confidence == null ? 0.5 : event.confidence;
  const kinds = ["pothole", "speed_bump", "rough_pavement"];
  const observations = ["impact", "pass", "fix"];
  const observation = event.observation || "impact";
  return typeof lat === "number" && Number.isFinite(lat) &&
    typeof lng === "number" && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    typeof accuracy === "number" && Number.isFinite(accuracy) &&
    accuracy >= 0 && accuracy <= 100 &&
    typeof speedKph === "number" && Number.isFinite(speedKph) && speedKph >= 0 &&
    typeof magnitude === "number" && Number.isFinite(magnitude) && magnitude >= 0 &&
    Number.isInteger(severity) && severity >= 1 && severity <= 3 &&
    Number.isFinite(time) && time >= sinceMs && time <= now + 5 * 60000 &&
    typeof confidence === "number" && Number.isFinite(confidence) &&
    confidence >= 0 && confidence <= 1 &&
    typeof event.deviceId === "string" && event.deviceId.length > 0 && event.deviceId.length <= 64 &&
    typeof event.tripId === "string" && event.tripId.length > 0 && event.tripId.length <= 64 &&
    kinds.includes(event.kind) && observations.includes(observation) &&
    (event.mode == null || ["vehicle", "pedestrian"].includes(event.mode)) &&
    (observation === "impact" ||
      (typeof event.hazardRef === "string" && event.hazardRef.length > 0 &&
       event.hazardRef.length <= 64));
}

/**
 * A manual "Still there" report uses legacy observation=impact, but has no
 * accelerometer measurement and references an existing hazard. It must NEVER
 * count as an independent sensor crossing or seed a new public hazard.
 * Untrusted clients can forge these fields, so this is only a minimum
 * validation gate; server-verified installation attestations are still needed.
 */
function isMeasuredImpact(event) {
  // Native sensor observations predate the explicit observation field.
  return (event.observation == null || event.observation === "impact") &&
    !event.hazardRef &&
    typeof event.magnitude === "number" && event.magnitude > 0 &&
    typeof event.accuracy === "number" && event.accuracy <= 50;
}

function isManualConfirmation(event) {
  return event.observation === "impact" &&
    typeof event.hazardRef === "string" && event.hazardRef.length > 0 &&
    event.magnitude === 0 && event.speedKph === 0 &&
    event.accuracy === 100 && event.confidence <= 0.35;
}

/** Greedy spatial clustering with a cell index, so it stays linear in practice. */
function clusterEvents(events) {
  const cell = 0.00015; // ~16 m
  const index = new Map();
  const clusters = [];

  const key = (lat, lng, kind) => `${kind}:${Math.round(lat / cell)}:${Math.round(lng / cell)}`;

  for (const event of events) {
    const lat = Number(event.lat);
    const lng = Number(event.lng);
    const gx = Math.round(lat / cell);
    const gy = Math.round(lng / cell);
    let target = null;
    for (let dx = -1; dx <= 1 && target === null; dx += 1) {
      for (let dy = -1; dy <= 1 && target === null; dy += 1) {
        const bucket = index.get(`${event.kind}:${gx + dx}:${gy + dy}`);
        if (bucket === undefined) {
          continue;
        }
        for (const candidate of bucket) {
          if (haversine(candidate.centre, { lat, lng }) <= MERGE_DISTANCE_M) {
            target = candidate;
            break;
          }
        }
      }
    }
    if (target === null) {
      target = { centre: { lat, lng }, events: [], sumLat: 0, sumLng: 0 };
      clusters.push(target);
      const bucket = index.get(key(lat, lng, event.kind)) ?? [];
      bucket.push(target);
      index.set(key(lat, lng, event.kind), bucket);
    }
    target.events.push(event);
    target.sumLat += lat;
    target.sumLng += lng;
    target.centre = {
      lat: target.sumLat / target.events.length,
      lng: target.sumLng / target.events.length,
    };
  }
  return clusters;
}

function majority(values, fallback) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function rowIdFor(lat, lng, kind = "pothole") {
  const ns = lat < 0 ? "s" : "n";
  const ew = lng < 0 ? "w" : "e";
  return `${kind[0]}${ns}${Math.abs(lat).toFixed(4)}${ew}${Math.abs(lng).toFixed(4)}`;
}

function buildHazard(cluster, now, silentPasses, fixReports, manualConfirmations = []) {
  const events = cluster.events;
  const devices = new Set(events.map((event) => event.deviceId));
  const trips = new Set(events.map((event) => `${event.deviceId}:${event.tripId}`));
  const days = new Set(events.map((event) => String(event.recordedAt).slice(0, 10)));
  const times = events.map((event) => Date.parse(event.recordedAt)).filter(Number.isFinite);
  const qualities = events.map((event) => Number(event.confidence ?? 0.5));
  const lastSeen = Math.max(...times);
  const firstSeen = Math.min(...times);

  const passCount = trips.size;
  const deviceCount = devices.size;
  const quality = qualities.reduce((sum, value) => sum + value, 0) / Math.max(1, qualities.length);

  const passFactor = Math.min(1, passCount / PUBLISH_MIN_PASSES);
  const deviceFactor = Math.min(1, deviceCount / PUBLISH_MIN_DEVICES);
  const ageDays = Math.max(0, (now - lastSeen) / MS_PER_DAY);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const belief = Math.min(1, 0.45 * passFactor + 0.3 * deviceFactor + 0.25 * quality);

  const rowId = rowIdFor(cluster.centre.lat, cluster.centre.lng, String(events[0].kind));
  // Explicit feedback can weakly support an already corroborated hazard but
  // cannot affect passCount, deviceCount, first/last measured timestamps or
  // publication eligibility. Never treat user-supplied IDs as verified people.
  const confirmations = new Set(manualConfirmations.filter((report) =>
    report.hazardRef === rowId &&
    report.kind === events[0].kind &&
    Date.parse(report.recordedAt) >= lastSeen &&
    now - Date.parse(report.recordedAt) <= 30 * MS_PER_DAY &&
    haversine({ lat: report.lat, lng: report.lng }, cluster.centre) <= 50
  ).map((report) => report.deviceId));
  const feedbackBonus = Math.min(0.03, confirmations.size * 0.01);

  // A pass or a fix report only counts if it happened after the last time
  // anyone felt this hazard, so a fresh impact resets the evidence that it has
  // been repaired.
  const closeToHazard = (event) =>
    haversine({ lat: Number(event.lat), lng: Number(event.lng) }, cluster.centre) <= 50;
  const clearDevices = new Set(
    silentPasses
      .filter((pass) =>
        pass.hazardRef === rowId && Date.parse(pass.recordedAt) > lastSeen && closeToHazard(pass))
      .map((pass) => pass.deviceId),
  );
  const fixDevices = new Set(
    fixReports
      .filter((report) =>
        report.hazardRef === rowId && Date.parse(report.recordedAt) > lastSeen && closeToHazard(report))
      .map((report) => report.deviceId),
  );

  return {
    rowId,
    data: {
      hazardId: `${cluster.centre.lat.toFixed(4)}:${cluster.centre.lng.toFixed(4)}`,
      lat: Number(cluster.centre.lat.toFixed(6)),
      lng: Number(cluster.centre.lng.toFixed(6)),
      kind: majority(events.map((event) => String(event.kind)), "pothole"),
      severity: Math.max(...events.map((event) => Number(event.severity) || 1)),
      passCount,
      deviceCount,
      dayCount: days.size,
      confidence: Math.round(Math.min(1, (belief + feedbackBonus) * recency) * 1000) / 1000,
      firstSeen: new Date(firstSeen).toISOString(),
      lastSeen: new Date(lastSeen).toISOString(),
      published: passCount >= PUBLISH_MIN_PASSES && deviceCount >= PUBLISH_MIN_DEVICES,
      clearPasses: clearDevices.size,
      fixedVotes: fixDevices.size,
    },
  };
}

async function listHazards() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const queries = [
      { method: "limit", values: [PAGE_SIZE] },
      { method: "offset", values: [offset] },
    ];
    const params = queries.map((q) =>
      `queries[]=${encodeURIComponent(JSON.stringify(q))}`).join("&");
    const res = await fetch(`${rowsUrl("hazards")}?${params}`, { headers: headers() });
    if (!res.ok) {
      throw new Error(`hazards read failed: ${res.status}`);
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.rows)) {
      throw new Error("invalid hazards response: rows array required");
    }
    const page = body.rows;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    if (offset >= 19500) throw new Error("Too many hazards for full recomputation");
  }
}

/**
 * Never keep a hazard labelled as current after ALL supporting impacts age
 * outside the evidence window. If input was truncated, leave old rows alone:
 * an incomplete history is not proof a road changed.
 */
function stalePublishedRows(existing, currentHazards, completeHistory) {
  if (!completeHistory) return [];
  const currentIds = new Set(currentHazards.map((hazard) => hazard.rowId));
  return existing.filter((row) =>
    row && row.published === true && typeof row.$id === "string" &&
    !currentIds.has(row.$id));
}

async function unpublishStaleHazard(row) {
  const response = await fetch(`${rowsUrl("hazards")}/${encodeURIComponent(row.$id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ data: { published: false } }),
  });
  if (!response.ok) throw new Error(`stale hazard update failed: ${response.status}`);
}

async function writeHazard(hazard, existingByRowId) {
  const existing = existingByRowId.get(hazard.rowId);
  if (existing === undefined) {
    const res = await fetch(rowsUrl("hazards"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ rowId: hazard.rowId, data: hazard.data }),
    });
    return res.ok ? "created" : `create failed ${res.status}`;
  }
  const payload = { ...hazard.data };
  const res = await fetch(`${rowsUrl("hazards")}/${hazard.rowId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ data: payload }),
  });
  return res.ok ? "updated" : `update failed ${res.status}`;
}

module.exports = async ({ res, log }) => {
  if (!ENDPOINT || !PROJECT || !KEY) {
    log(
      `missing environment: endpoint=${Boolean(ENDPOINT)} project=${Boolean(PROJECT)} key=${Boolean(KEY)}`,
    );
    log(
      `available: ${Object.keys(process.env)
        .filter((name) => name.startsWith("APPWRITE"))
        .join(",")}`,
    );
    return res.json({ ok: false, error: "missing environment" }, 500);
  }
  try {
    const now = Date.now();
    const sinceIso = new Date(now - LOOKBACK_DAYS * MS_PER_DAY).toISOString();
    const incoming = await fetchEvents(sinceIso);
    // A truncated observation window must never be presented as a complete
    // public road map. Stop before any writes; increase capacity with cursor
    // pagination and bounded reconciliation before accepting more evidence.
    if (incoming.length >= MAX_EVENTS) {
      log("observation limit reached; leaving existing hazard map unchanged");
      return res.json({ ok: false, error: "observation capacity reached" }, 503);
    }
    const events = incoming.filter((event) => validEvent(event, now - LOOKBACK_DAYS * MS_PER_DAY, now));
    if (incoming.length !== events.length) {
      log(`rejected ${incoming.length - events.length} malformed observations`);
    }
    // A nonempty history consisting entirely of malformed records is not
    // evidence that all previously reported road hazards disappeared.
    if (incoming.length > 0 && events.length === 0) {
      log("all observations rejected; existing hazard map preserved");
      return res.json({ ok: false, error: "no valid observations" }, 503);
    }
    const incidents = events.filter(isMeasuredImpact);
    const manualConfirmations = events.filter(isManualConfirmation);
    const silentPasses = events.filter((event) => event.observation === "pass");
    const fixReports = events.filter((event) => event.observation === "fix");
    log(
      `read ${events.length} events (${incidents.length} sensor impacts, ${manualConfirmations.length} manual confirmations, ${silentPasses.length} passes, ${fixReports.length} fix reports)`,
    );

    const clusters = clusterEvents(incidents);
    const hazards = clusters.map((cluster) =>
      buildHazard(cluster, now, silentPasses, fixReports, manualConfirmations));
    const existing = await listHazards();
    const existingByRowId = new Map(existing.map((row) => [row.$id, row]));

    let created = 0;
    let updated = 0;
    let failed = 0;
    for (const hazard of hazards) {
      const outcome = await writeHazard(hazard, existingByRowId);
      if (outcome === "created") {
        created += 1;
      } else if (outcome === "updated") {
        updated += 1;
      } else {
        failed += 1;
        log(`${hazard.rowId}: ${outcome}`);
      }
    }

    let unpublished = 0;
    // Don't hide any previous hazard if a write failed or the event window
    // hit its cap; partial evidence cannot safely invalidate old rows.
    const complete = incoming.length < MAX_EVENTS && failed === 0;
    const stale = stalePublishedRows(existing, hazards, complete);
    for (const row of stale) {
      await unpublishStaleHazard(row);
      unpublished += 1;
    }
    const published = hazards.filter((hazard) => hazard.data.published).length;
    log(`hazards: ${hazards.length} (${published} published), created ${created}, updated ${updated}, stale hidden ${unpublished}`);
    // Partial publication is not a successful run. Surface the failure so
    // operators can retry instead of silently trusting an incomplete map.
    return res.json({
      ok: failed === 0,
      events: events.length,
      hazards: hazards.length,
      published,
      created,
      updated,
      unpublished,
      failed,
    }, failed > 0 ? 503 : 200);
  } catch (error) {
    log(String(error));
    return res.json({ ok: false, error: String(error) }, 500);
  }
};


// Export deterministic domain helpers for the repository's regression tests.
module.exports.testing = {
  validEvent, clusterEvents, buildHazard, rowIdFor, stalePublishedRows,
  isMeasuredImpact, isManualConfirmation
};

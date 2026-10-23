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
    const rows = body.rows ?? [];
    events.push(...rows);
    if (rows.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }
  return events;
}

/** Greedy spatial clustering with a cell index, so it stays linear in practice. */
function clusterEvents(events) {
  const cell = 0.00015; // ~16 m
  const index = new Map();
  const clusters = [];

  const key = (lat, lng) => `${Math.round(lat / cell)}:${Math.round(lng / cell)}`;

  for (const event of events) {
    const lat = Number(event.lat);
    const lng = Number(event.lng);
    const gx = Math.round(lat / cell);
    const gy = Math.round(lng / cell);
    let target = null;
    for (let dx = -1; dx <= 1 && target === null; dx += 1) {
      for (let dy = -1; dy <= 1 && target === null; dy += 1) {
        const bucket = index.get(`${gx + dx}:${gy + dy}`);
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
      const bucket = index.get(key(lat, lng)) ?? [];
      bucket.push(target);
      index.set(key(lat, lng), bucket);
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

function rowIdFor(lat, lng) {
  const ns = lat < 0 ? "s" : "n";
  const ew = lng < 0 ? "w" : "e";
  return `${ns}${Math.abs(lat).toFixed(4)}${ew}${Math.abs(lng).toFixed(4)}`;
}

function buildHazard(cluster, now, silentPasses) {
  const events = cluster.events;
  const devices = new Set(events.map((event) => event.deviceId));
  const days = new Set(events.map((event) => String(event.recordedAt).slice(0, 10)));
  const times = events.map((event) => Date.parse(event.recordedAt)).filter(Number.isFinite);
  const qualities = events.map((event) => Number(event.confidence ?? 0.5));
  const lastSeen = Math.max(...times);
  const firstSeen = Math.min(...times);

  const passCount = events.length;
  const deviceCount = devices.size;
  const quality = qualities.reduce((sum, value) => sum + value, 0) / Math.max(1, qualities.length);

  const passFactor = Math.min(1, passCount / PUBLISH_MIN_PASSES);
  const deviceFactor = Math.min(1, deviceCount / PUBLISH_MIN_DEVICES);
  const ageDays = Math.max(0, (now - lastSeen) / MS_PER_DAY);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const belief = Math.min(1, 0.45 * passFactor + 0.3 * deviceFactor + 0.25 * quality);

  const rowId = rowIdFor(cluster.centre.lat, cluster.centre.lng);

  // A pass only counts if it happened after the last time anyone felt this
  // hazard, so a fresh impact resets the evidence that it has been repaired.
  const clearDevices = new Set(
    silentPasses
      .filter((pass) => pass.hazardRef === rowId && Date.parse(pass.recordedAt) > lastSeen)
      .map((pass) => pass.deviceId),
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
      confidence: Math.round(Math.min(1, belief * recency) * 1000) / 1000,
      firstSeen: new Date(firstSeen).toISOString(),
      lastSeen: new Date(lastSeen).toISOString(),
      published: passCount >= PUBLISH_MIN_PASSES && deviceCount >= PUBLISH_MIN_DEVICES,
      clearPasses: clearDevices.size,
    },
  };
}

async function listHazards() {
  const url = `${rowsUrl("hazards")}?${encodeURIComponent("queries[]")}=${encodeURIComponent(
    JSON.stringify({ method: "limit", values: [PAGE_SIZE] }),
  )}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`hazards read failed: ${res.status}`);
  }
  return (await res.json()).rows ?? [];
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
  if (typeof existing.fixedVotes === "number" && existing.fixedVotes > 0) {
    payload.fixedVotes = existing.fixedVotes;
  }
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
    const events = await fetchEvents(sinceIso);
    const incidents = events.filter((event) => event.observation !== "pass");
    const silentPasses = events.filter((event) => event.observation === "pass");
    log(`read ${events.length} events (${incidents.length} impacts, ${silentPasses.length} passes)`);

    const clusters = clusterEvents(incidents);
    const hazards = clusters.map((cluster) => buildHazard(cluster, now, silentPasses));
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

    const published = hazards.filter((hazard) => hazard.data.published).length;
    log(`hazards: ${hazards.length} (${published} published), created ${created}, updated ${updated}`);
    return res.json({
      ok: true,
      events: events.length,
      hazards: hazards.length,
      published,
      created,
      updated,
      failed,
    });
  } catch (error) {
    log(String(error));
    return res.json({ ok: false, error: String(error) }, 500);
  }
};

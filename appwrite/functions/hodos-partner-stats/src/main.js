/**
 * Hodos partner footfall aggregation.
 *
 * The app never uploads a driver or a route for this. It uploads one row per
 * (shop, month) containing a blinded pass token:
 *
 *   passToken = SHA-256(installationId | partnerId | YYYY-MM) truncated
 *
 * Because the token is salted by both the shop and the month, the server can
 * count unique passes for one shop in one month but cannot link a device across
 * shops or across months. This function turns those tokens into a public
 * per-partner count that the app can show next to a shop pin.
 */

const ENDPOINT =
  process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;

const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";
const PAGE_SIZE = 500;
const MAX_PASSES = 20000;

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

function validMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validRow(row, month) {
  if (!row || typeof row !== "object") return false;
  const partnerId = row.partnerId;
  const token = row.passToken;
  return typeof partnerId === "string" && partnerId.length > 0 && partnerId.length <= 64 &&
    typeof token === "string" && token.length >= 8 && token.length <= 64 &&
    validMonth(row.month) && row.month === month;
}

/** Deterministic, collision-resistant-enough row id within Appwrite's 36-char limit. */
function hashId(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function statRowId(partnerId, month) {
  return `p_${hashId(`${partnerId}|${month}`)}_${month.replace("-", "")}`;
}

/**
 * Group unique blinded tokens per partner. A repeated row from a retry or a
 * multi-device installation cannot inflate the count, and a device that passes
 * the same shop five times in a month still counts once.
 */
function countByPartner(passes, month) {
  const counts = new Map();
  for (const pass of passes) {
    if (!validRow(pass, month)) continue;
    const partnerId = pass.partnerId;
    if (!counts.has(partnerId)) counts.set(partnerId, new Set());
    counts.get(partnerId).add(pass.passToken);
  }
  const result = new Map();
  for (const [partnerId, tokens] of counts) {
    result.set(partnerId, tokens.size);
  }
  return result;
}

async function listTable(table) {
  const rows = [];
  let offset = 0;
  let cursorId = null;
  for (;;) {
    const queries = [
      { method: "limit", values: [PAGE_SIZE] },
      cursorId
        ? { method: "cursorAfter", values: [cursorId] }
        : { method: "offset", values: [offset] },
    ];
    const params = queries
      .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
      .join("&");
    const response = await fetch(`${rowsUrl(table)}?${params}`, { headers: headers() });
    if (!response.ok) {
      throw new Error(`${table} read failed: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    if (!body || !Array.isArray(body.rows)) {
      throw new Error(`invalid ${table} response: rows array required`);
    }
    rows.push(...body.rows);
    if (body.rows.length < PAGE_SIZE) return rows;
    if (rows.length >= MAX_PASSES) {
      throw new Error(`${table} exceeded the safe aggregation window`);
    }
    const last = body.rows[body.rows.length - 1];
    if (last && typeof last.$id === "string" && last.$id.length > 0) {
      cursorId = last.$id;
    } else {
      cursorId = null;
      offset += PAGE_SIZE;
    }
  }
}

async function fetchMonthPasses(month) {
  const rows = [];
  let offset = 0;
  let cursorId = null;
  while (rows.length < MAX_PASSES) {
    const queries = [
      { method: "equal", attribute: "month", values: [month] },
      { method: "limit", values: [PAGE_SIZE] },
      cursorId
        ? { method: "cursorAfter", values: [cursorId] }
        : { method: "offset", values: [offset] },
    ];
    const params = queries
      .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
      .join("&");
    const response = await fetch(`${rowsUrl("partnerPasses")}?${params}`, {
      headers: headers(),
    });
    if (!response.ok) {
      throw new Error(`partnerPasses read failed: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    if (!body || !Array.isArray(body.rows)) {
      throw new Error("invalid partnerPasses response: rows array required");
    }
    rows.push(...body.rows);
    if (body.rows.length < PAGE_SIZE) break;
    const last = body.rows[body.rows.length - 1];
    if (last && typeof last.$id === "string" && last.$id.length > 0) {
      cursorId = last.$id;
    } else {
      cursorId = null;
      offset += PAGE_SIZE;
    }
  }
  return rows;
}

async function writeStat(existing, partnerId, month, uniqueDevices, nowIso) {
  const rowId = statRowId(partnerId, month);
  const data = { partnerId, month, uniqueDevices, updatedAt: nowIso };
  if (existing.has(rowId)) {
    const response = await fetch(`${rowsUrl("partnerStats")}/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ data }),
    });
    if (!response.ok) throw new Error(`stat update failed: ${response.status}`);
    return "updated";
  }
  const response = await fetch(rowsUrl("partnerStats"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ rowId, data }),
  });
  if (!response.ok) throw new Error(`stat create failed: ${response.status}`);
  return "created";
}

function currentMonth(nowMs) {
  const date = new Date(nowMs);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

module.exports = async ({ res, log }) => {
  if (!ENDPOINT || !PROJECT || !KEY) {
    log("missing environment for partner stats");
    return res.json({ ok: false, error: "missing environment" }, 500);
  }
  try {
    const now = Date.now();
    const month = currentMonth(now);
    const passes = await fetchMonthPasses(month);
    const counts = countByPartner(passes, month);
    const existingRows = await listTable("partnerStats");
    const existing = new Set(existingRows.map((row) => row.$id));
    let created = 0;
    let updated = 0;
    let failed = 0;
    const nowIso = new Date(now).toISOString();
    for (const [partnerId, uniqueDevices] of counts) {
      try {
        const outcome = await writeStat(existing, partnerId, month, uniqueDevices, nowIso);
        if (outcome === "created") created += 1;
        else updated += 1;
        existing.add(statRowId(partnerId, month));
      } catch (error) {
        failed += 1;
        log(`${partnerId}: ${error}`);
      }
    }
    log(`partner stats ${month}: ${counts.size} partners, created ${created}, updated ${updated}, failed ${failed}`);
    return res.json({ ok: failed === 0, month, partners: counts.size, created, updated, failed },
      failed > 0 ? 503 : 200);
  } catch (error) {
    log(String(error));
    return res.json({ ok: false, error: String(error) }, 500);
  }
};

module.exports.testing = {
  validMonth,
  validRow,
  countByPartner,
  currentMonth,
  statRowId,
};

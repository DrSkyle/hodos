/**
 * Validated ingest for anonymous partner footfall.
 *
 * Public create is disabled on partnerPasses. Every write goes through this
 * function, which:
 *   - verifies an inexpensive proof-of-work bound to the exact (shop, token),
 *   - derives month/day on the server so a client cannot backdate or duplicate,
 *   - makes writes idempotent with a deterministic row id,
 *   - rate-limits per client IP per hour and per shop per day.
 *
 * The token itself is SHA-256(installation | shop | month) truncated on the
 * device, so the server can count unique drivers per shop per month without
 * being able to link a device across shops or months.
 */

const crypto = require("node:crypto");

const ENDPOINT =
  process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;
const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";

const POW_DIFFICULTY = 4; // leading hex zeros (~65k hashes, tens of ms on a phone)
const IP_HOURLY_LIMIT = 180;
const PARTNER_DAILY_LIMIT = 5000;

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashId(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function rowIdFor(partnerId, passToken) {
  return `pp_${hashId(`${partnerId}|${passToken}`)}`;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body.data && typeof body.data === "object" ? body.data : body;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed.data === "object" ? parsed.data : parsed;
  } catch (_) {
    return {};
  }
}

/**
 * Appwrite exposes the HTTP payload across several request fields. `bodyJson`
 * is a lazy getter that throws on an empty body, so every access is guarded and
 * the raw text fields are read first.
 */
function extractPayload(req) {
  if (!req || typeof req !== "object") return {};
  const read = (getter) => {
    try {
      return getter();
    } catch (_) {
      return undefined;
    }
  };
  const sources = [
    read(() => req.bodyText),
    read(() => req.bodyRaw),
    read(() => req.body),
    read(() => req.bodyBinary),
    read(() => req.bodyJson),
  ];
  for (const source of sources) {
    if (source == null) continue;
    let parsed = source;
    if (typeof source === "string") {
      if (source.length === 0) continue;
      try {
        parsed = JSON.parse(source);
      } catch (_) {
        continue;
      }
    } else if (source instanceof Uint8Array) {
      try {
        parsed = JSON.parse(Buffer.from(source).toString("utf8"));
      } catch (_) {
        continue;
      }
    }
    if (parsed && typeof parsed === "object") {
      if (parsed.data && typeof parsed.data === "object") return parsed.data;
      return parsed;
    }
  }
  return {};
}

function validPartnerId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,64}$/.test(value);
}

function validToken(value) {
  return typeof value === "string" && /^[a-f0-9]{16,64}$/.test(value);
}

function validNonce(value) {
  const text = String(value ?? "");
  return /^[0-9]{1,12}$/.test(text);
}

/** Hashcash-style proof bound to shop + token, so proofs cannot be replayed elsewhere. */
function proofOk(partnerId, passToken, nonce) {
  const digest = sha256(`${partnerId}|${passToken}|${nonce}`);
  return digest.startsWith("0".repeat(POW_DIFFICULTY));
}

function utcParts(nowMs) {
  const date = new Date(nowMs);
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const day = date.toISOString().slice(0, 10);
  const hour = date.toISOString().slice(0, 13);
  return { month, day, hour };
}

async function getRow(table, rowId) {
  const response = await fetch(`${rowsUrl(table)}/${encodeURIComponent(rowId)}`, {
    headers: headers(),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${table} read failed: ${response.status}`);
  return response.json();
}

async function upsertRow(table, rowId, data) {
  const response = await fetch(rowsUrl(table), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ rowId, data }),
  });
  if (response.ok) return "created";
  if (response.status === 409) {
    const patch = await fetch(`${rowsUrl(table)}/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ data }),
    });
    if (patch.ok) return "updated";
    throw new Error(`${table} update failed: ${patch.status}`);
  }
  throw new Error(`${table} create failed: ${response.status}`);
}

async function countRows(table, queries) {
  const params = queries
    .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
    .join("&");
  const response = await fetch(`${rowsUrl(table)}?${params}`, { headers: headers() });
  if (!response.ok) throw new Error(`${table} count failed: ${response.status}`);
  const body = await response.json();
  return Number(body.total) || 0;
}

async function checkIpRate(ip, hour) {
  const bucket = hashId(`${ip}|${hour}`);
  const rowId = `rl_${bucket}`;
  const existing = await getRow("partnerRate", rowId);
  const count = existing ? Number(existing.count) || 0 : 0;
  if (count >= IP_HOURLY_LIMIT) return false;
  await upsertRow("partnerRate", rowId, { bucket, count: count + 1, hour });
  return true;
}

module.exports = async ({ req, res, log }) => {
  if (!ENDPOINT || !PROJECT || !KEY) {
    log("missing environment for partner pass ingest");
    return res.json({ ok: false, error: "missing environment" }, 500);
  }
  try {
    const body = extractPayload(req);
    const partnerId = body.partnerId;
    const passToken = body.passToken;
    const nonce = body.nonce;

    if (!validPartnerId(partnerId) || !validToken(passToken) || !validNonce(nonce)) {
      return res.json({ ok: false, error: "invalid pass" }, 400);
    }
    if (!proofOk(partnerId, passToken, nonce)) {
      return res.json({ ok: false, error: "invalid proof" }, 400);
    }

    const now = Date.now();
    const { month, day, hour } = utcParts(now);

    // Idempotent: a retried pass is already counted.
    const rowId = rowIdFor(partnerId, passToken);
    const existing = await getRow("partnerPasses", rowId);
    if (existing) {
      return res.json({ ok: true, duplicate: true, month, day }, 200);
    }

    const ip =
      (req.headers && (req.headers["x-appwrite-client-ip"] ||
        req.headers["x-forwarded-for"] ||
        req.headers["x-real-ip"])) ||
      "unknown";
    if (!(await checkIpRate(String(ip).split(",")[0].trim(), hour))) {
      return res.json({ ok: false, error: "rate limited" }, 429);
    }

    const daily = await countRows("partnerPasses", [
      { method: "equal", attribute: "partnerId", values: [partnerId] },
      { method: "equal", attribute: "day", values: [day] },
      { method: "limit", values: [1] },
    ]);
    if (daily >= PARTNER_DAILY_LIMIT) {
      return res.json({ ok: false, error: "partner daily cap reached" }, 429);
    }

    const outcome = await upsertRow("partnerPasses", rowId, {
      partnerId,
      passToken,
      month,
      day,
    });
    log(`partner pass ${partnerId} ${month} ${outcome}`);
    return res.json({ ok: true, duplicate: outcome === "updated", month, day }, 200);
  } catch (error) {
    log(String(error));
    return res.json({ ok: false, error: String(error) }, 500);
  }
};

module.exports.testing = {
  sha256,
  rowIdFor,
  parseBody,
  extractPayload,
  validPartnerId,
  validToken,
  validNonce,
  proofOk,
  utcParts,
};

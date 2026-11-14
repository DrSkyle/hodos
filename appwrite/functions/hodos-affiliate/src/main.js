/**
 * Hodos newsletter.
 *
 * The only thing this function still does is store an email address for road
 * notes, in a table with no client permissions, keyed by a hash of the address so
 * the same one cannot be stored twice. Product offers are now served from the
 * affiliate partners directly, in the web app's own partner list, so there is no
 * catalogue key here any more.
 */

const ENDPOINT = process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;
const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";
const UPSTREAM_TIMEOUT_MS = 12_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Appwrite-Project",
  "Cache-Control": "public, max-age=300"
};

function validEmail(value) {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return clean.length >= 5 &&
    clean.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

function normaliseEmail(value) {
  return value.trim().toLowerCase();
}

function log(message) {
  if (typeof console !== "undefined" && typeof console.log === "function") console.log(message);
}

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function subscribe(email, source) {
  const clean = normaliseEmail(email);
  if (!validEmail(clean)) {
    return { ok: false, error: "invalid email" };
  }
  if (!ENDPOINT || !PROJECT || !KEY) {
    return { ok: false, error: "storage not configured" };
  }

  const rowId = (await sha256Hex(clean)).slice(0, 32);
  const response = await fetch(
    `${ENDPOINT}/tablesdb/${DATABASE_ID}/tables/subscribers/rows`,
    {
      method: "POST",
      headers: {
        "X-Appwrite-Project": PROJECT,
        "X-Appwrite-Key": KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rowId,
        data: {
          email: clean,
          source: typeof source === "string" ? source.slice(0, 32) : "unknown",
          consent: "garage-v1",
          at: new Date().toISOString()
        }
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    }
  );

  // A duplicate row id means this address is already on the list. Report
  // success so the form never reveals who is or is not subscribed.
  if (response.status === 409) return { ok: true, duplicate: true };
  if (!response.ok) {
    log(`subscribe ${response.status}`);
    return { ok: false, error: "could not save" };
  }
  return { ok: true, duplicate: false };
}

module.exports = async function main(context) {
  const { req, res } = context;
  const body = parseBody(req.body);
  const method = String(req.method || "POST").toUpperCase();

  if (method === "OPTIONS") return res.send("", 204, CORS);

  const action = body.action || "subscribe";

  if (action === "subscribe") {
    try {
      const result = await subscribe(body.email, body.source);
      return res.json(result, result.ok ? 200 : 400, CORS);
    } catch (error) {
      log(`subscribe failed: ${error}`);
      return res.json({ ok: false, error: "could not save" }, 502, CORS);
    }
  }

  return res.json({ ok: false, error: "unknown action", actions: ["subscribe"] }, 400, CORS);
};

module.exports.testing = {
  validEmail,
  normaliseEmail,
  parseBody
};

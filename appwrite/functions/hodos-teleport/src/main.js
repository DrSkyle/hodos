/**
 * Admitad Teleport, server side.
 *
 * A browser cannot call Teleport: Admitad only accepts the request from the
 * publisher's server, and it must carry the *visitor's* user agent, referer and
 * IP so attribution and country-based rates work. So this function does one
 * thing — take an Admitad affiliate link, ask Teleport for the advertiser URL,
 * and hand it back — and never caches, because the response is per click.
 *
 * Nothing here runs without consent. The visitor's IP and user agent are online
 * identifiers, and Admitad's publisher terms require consent before passing
 * them, so the caller must state that consent was given.
 */

const TELEPORT_HOST_SUFFIX = ".admitad.com";
const DIRECT_HOSTS = ["ad.admitad.com", "admitad.com"];

const ENDPOINT = process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;
const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";
const ACCESS_TOKEN = process.env.ADMITAD_ACCESS_TOKEN;

const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Appwrite-Project",
  "Cache-Control": "no-store"
};

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

/** Only Admitad's own tracking hosts, so this can never be used as a proxy. */
function isAdmitadHost(host) {
  const lower = host.toLowerCase();
  return DIRECT_HOSTS.includes(lower) || lower.endsWith(TELEPORT_HOST_SUFFIX);
}

/** Turns /g/<hash>/ into /tptv2/<hash>/, the documented transform. */
function toTeleportUrl(affiliateUrl) {
  let parsed;
  try {
    parsed = new URL(affiliateUrl);
  } catch (_) {
    return { error: "not a valid URL" };
  }
  if (parsed.protocol !== "https:") return { error: "https only" };
  if (!isAdmitadHost(parsed.hostname)) return { error: "not an Admitad link" };

  const match = parsed.pathname.match(/^\/g\/([A-Za-z0-9_-]{8,128})\/?$/);
  if (!match) {
    return { error: "expected an Admitad affiliate link with a /g/<id>/ path" };
  }
  const hash = match[1];
  const base = new URL(`https://${parsed.hostname}/tptv2/${hash}/`);
  return { url: base, hash };
}

function clientIp(req, body) {
  const headers = req && req.headers ? req.headers : {};
  const forwarded = headers["x-forwarded-for"] || headers["x-real-ip"] ||
    headers["x-appwrite-client-ip"];
  const fromHeader = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
  if (fromHeader) return fromHeader;
  return typeof body.ip === "string" ? body.ip.trim() : "";
}

async function recordClick(entry) {
  if (!ENDPOINT || !PROJECT || !KEY) return;
  try {
    await fetch(`${ENDPOINT}/tablesdb/${DATABASE_ID}/tables/teleportClicks/rows`, {
      method: "POST",
      headers: {
        "X-Appwrite-Project": PROJECT,
        "X-Appwrite-Key": KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rowId: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        data: {
          hash: String(entry.hash || "").slice(0, 128),
          ok: Boolean(entry.ok),
          reason: String(entry.reason || "").slice(0, 64),
          at: new Date().toISOString()
        }
      }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (_) {
    // Click logging is best effort; it must never break the redirect.
  }
}

module.exports = async function main(context) {
  const { req, res } = context;
  const method = String(req.method || "POST").toUpperCase();
  if (method === "OPTIONS") return res.send("", 204, CORS);

  const body = parseBody(req.body);
  const consent = body.consent === true;
  const target = typeof body.url === "string" ? body.url.trim().slice(0, MAX_URL_LENGTH) : "";

  if (!target) {
    return res.json({ ok: false, error: "no link supplied" }, 400, CORS);
  }
  if (!consent) {
    // Without consent we must not pass a visitor's identifiers to Admitad, so the
    // caller is told to fall back to the plain affiliate link.
    return res.json({
      ok: false,
      error: "consent required",
      fallback: target
    }, 403, CORS);
  }

  const prepared = toTeleportUrl(target);
  if (prepared.error || !prepared.url) {
    await recordClick({ hash: "", ok: false, reason: prepared.error });
    return res.json({ ok: false, error: prepared.error, fallback: target }, 400, CORS);
  }

  const ip = clientIp(req, body);
  const userAgent = String(body.userAgent || (req.headers && req.headers["user-agent"]) || "").slice(0, 400);
  const referer = String(body.referer || "").slice(0, 400);
  if (!userAgent || !referer) {
    return res.json({ ok: false, error: "userAgent and referer are required", fallback: target }, 400, CORS);
  }
  if (!ip) {
    // Admitad needs the visitor's IP for country-dependent programs; if we cannot
    // supply it the click should fall back rather than misattribute.
    return res.json({ ok: false, error: "visitor IP unavailable", fallback: target }, 400, CORS);
  }

  const request = prepared.url;
  request.searchParams.set("user_agent", userAgent);
  request.searchParams.set("referer", referer);
  request.searchParams.set("ip_addr", ip);
  const subid = String(body.subid || "").slice(0, 50);
  if (subid) request.searchParams.set("subid", subid);

  try {
    const headers = { "User-Agent": "Hodos-Teleport", Accept: "application/json" };
    if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
    const response = await fetch(request.toString(), {
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    if (!response.ok) {
      await recordClick({ hash: prepared.hash, ok: false, reason: `upstream ${response.status}` });
      return res.json({ ok: false, error: `teleport ${response.status}`, fallback: target }, 502, CORS);
    }

    const payload = await response.json().catch(() => null);
    const redirectUrl = Array.isArray(payload) ? payload[0] : payload?.redirect_url;
    if (typeof redirectUrl !== "string" || !/^https:\/\//i.test(redirectUrl)) {
      await recordClick({ hash: prepared.hash, ok: false, reason: "no redirect returned" });
      return res.json({ ok: false, error: "teleport returned no link", fallback: target }, 502, CORS);
    }

    // A dummy URL means the program is gone or the link is broken. Admitad asks
    // that such clicks still be redirected and tracked, so we log and pass it on.
    await recordClick({ hash: prepared.hash, ok: true, reason: "resolved" });
    return res.json({ ok: true, redirectUrl }, 200, CORS);
  } catch (error) {
    log(`teleport failed: ${error}`);
    await recordClick({ hash: prepared.hash, ok: false, reason: "network" });
    return res.json({ ok: false, error: "teleport unreachable", fallback: target }, 502, CORS);
  }
};

module.exports.testing = {
  isAdmitadHost,
  toTeleportUrl,
  parseBody,
  clientIp
};

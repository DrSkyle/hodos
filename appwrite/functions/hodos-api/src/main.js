/**
 * Hodos agent API.
 *
 * One function, one key, one meter. Every call is billed in micro-USD against a
 * prepaid credit balance, so a customer's AI agent can decide for itself
 * whether a call is worth making and stop when the balance runs out.
 *
 * The customer's agent is the client here: it discovers the manifest, asks its
 * human to approve setup, then works with a key. Nothing about a person leaves
 * the phone, and keys are stored only as hashes.
 */

const ENDPOINT = process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;
const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";

const TRIAL_MICRO = 2000;          // $0.002 of credit, enough to judge the data
const MAX_KEYS_PER_IP_HOUR = 3;
const PAGE = 500;

/** Prices per call, in micro-USD (1_000_000 = $1). */
const PRICES = {
  hazards: 100,
  garage: 80,
  partners: 80,
  roads: 300,
  graph: 1200,
  report: 0,
  credits: 0,
  manifest: 0,
  provision: 0,
  topup: 0,
  partnerQuote: 0,
  partnerPlace: 0
};

/**
 * A partner placement is sold by the day, and the daily price follows the local
 * economy rather than one global number: a shop in Kathmandu or Lagos pays a
 * fraction of what a shop in California pays, in its own currency. All three
 * tiers are published, so nobody has to guess what they will be charged.
 */
const PARTNER_TIERS = {
  // Where a shop's typical day of takings is measured in hundreds of dollars.
  high: { usdPerDay: 1.99, label: "Standard" },
  // Middle-income markets: real budget for a shop, still a cheap experiment.
  mid: { usdPerDay: 0.79, label: "Local" },
  // Where the Garage catalogue barely reaches: priced to be an easy yes.
  low: { usdPerDay: 0.19, label: "Access" }
};

const PARTNER_MAX_DAYS = 365;
const DAY_MS = 86_400_000;
const FX_TTL_MS = 12 * 60 * 60 * 1000;
const FX_URL = "https://open.er-api.com/v6/latest/USD";

/** Fallback rates for the currencies this offer is most often bought in. */
const FX_FALLBACK = {
  USD: 1, NPR: 135, INR: 84, PKR: 278, BDT: 120, LKR: 300,
  NGN: 1550, KES: 129, GHS: 15.2, TZS: 2700, UGX: 3700,
  ZMW: 27, EGP: 48, VND: 25400, PHP: 58, IDR: 15800,
  MYR: 4.5, THB: 34
};

/** Which daily tier a country is sold at. Anything unlisted is `high`. */
const COUNTRY_TIER = {
  high: ["US","CA","GB","AU","NZ","IE","DE","FR","NL","BE","AT","CH","IT","ES","PT",
         "FI","SE","NO","DK","IS","LU","JP","KR","SG","AE","IL","HK","TW","QA","KW","SA"],
  mid: ["MX","BR","AR","CL","CO","PE","UY","CR","PA","TR","ZA","TH","MY","CN","PL","CZ",
        "SK","HU","GR","RO","BG","HR","SI","EE","LV","LT","RU","KZ","UA","RS","BY","EG","MA","TN","DZ","JO","LB","OM","BH"],
  low: ["NP","IN","PK","BD","LK","BT","MM","KH","LA","VN","PH","ID","NG","KE","GH","TZ",
        "UG","ZM","ET","SN","CI","CM","ZW","MW","RW","MZ","AO","MG","BF","ML","NE","TD",
        "CD","CG","BJ","TG","GN","SL","LR","GM","SO","SD","SS","YE","SY","IQ","AF","PS",
        "BO","PY","HN","GT","SV","NI","VE","HT","CU","DO","JM","FJ","PG"]
};

/** Language-region and bare-region tags mapped to the currency people use. */
const REGION_CURRENCY = {
  NP: "NPR", IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", BT: "BTN",
  NG: "NGN", KE: "KES", GH: "GHS", TZ: "TZS", UG: "UGX", ZM: "ZMW",
  EG: "EGP", VN: "VND", PH: "PHP", ID: "IDR", MY: "MYR", TH: "THB",
  US: "USD", GB: "GBP", EU: "EUR", DE: "EUR", FR: "EUR", ES: "EUR",
  IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", BE: "EUR",
  CA: "CAD", AU: "AUD", JP: "JPY", CN: "CNY", KR: "KRW", BR: "BRL"
};

const ACTIONS = {
  hazards: "Hazard points for a bounding box or radius, with severity, kind, pass count and last-seen time.",
  roads: "Road-quality cells: surface kind, quality score, roughness and wear for a corridor.",
  garage: "Current in-stock offers for a Garage shelf, with merchant, price and link.",
  partners: "Live local shop pins for an area: name, category, line of text and position. These are the shops riders see on the map.",
  graph: "Time series and heat layers for a region. The expensive call.",
  report: "Silently file an error or a suggested fix with the Hodos maintainers.",
  credits: "Read the remaining balance and recent usage for this key.",
  manifest: "This document. Free, no key required.",
  provision: "Create a key with trial credit after the user approves setup.",
  topup: "Register a payment reference for manual credit settlement.",
  partnerQuote: "Price a shop placement in the caller's own currency. Free.",
  partnerPlace: "Place a free initial local shop pin on the live map and mint its one-time Owner Secret Key.",
  partnerExtend: "Add days to a placement.",
  partnerStatus: "Read a placement's live status, expiry, and anonymous monthly pass count. Free.",
  partnerPortal: "Read private Shop Owner Dashboard analytics (passes, nearby hazards, expiry) with Pin ID + Owner Secret Key.",
  partnerUpdate: "Update a shop's live offer, category, phone, and website link with Pin ID + Owner Secret Key.",
  partnerRequestDays: "Request additional live days for a shop pin with Pin ID + Owner Secret Key.",
  referralCreate: "Paused while initial shop pins are free globally.",
  referralProfile: "Read a referral's earnings, balance and payout readiness. Nepal only.",
  referralRequestPayout: "Ask for the earnable balance to be paid to a Nepali wallet. Nepal only."
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Appwrite-Project, X-Hodos-Key",
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

function headersOf(req) {
  const source = req && req.headers;
  if (!source) return {};
  const out = {};
  for (const [name, value] of Object.entries(source)) out[name.toLowerCase()] = value;
  return out;
}

/**
 * The key travels in the request body: Appwrite's execution endpoint does not
 * forward arbitrary client headers into the function, so a header-only scheme
 * would silently fail. The body is carried over TLS and is never logged here —
 * only its hash is ever written down.
 */
function apiKeyFrom(req, body) {
  const headers = headersOf(req);
  const supplied = body.apiKey || body.key || headers["x-hodos-key"];
  return typeof supplied === "string" ? supplied.trim() : "";
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Appwrite row ids cap at 36 chars; 32 hex chars is plenty to hide the key. */
async function keyId(apiKey) {
  return (await sha256Hex(apiKey)).slice(0, 32);
}

async function api(path, options = {}) {
  const response = await fetch(`${ENDPOINT}${path}`, {
    ...options,
    headers: {
      "X-Appwrite-Project": PROJECT,
      "X-Appwrite-Key": KEY,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(options.timeoutMs || 12_000)
  });
  return response;
}

async function readRow(table, rowId) {
  const response = await api(`/tablesdb/${DATABASE_ID}/tables/${table}/rows/${rowId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${table} read ${response.status}`);
  return response.json();
}

async function readRows(table, queries = []) {
  const encoded = queries
    .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
    .join("&");
  const response = await api(
    `/tablesdb/${DATABASE_ID}/tables/${table}/rows${encoded ? `?${encoded}` : ""}`
  );
  if (!response.ok) throw new Error(`${table} read ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.rows) ? body.rows : [];
}

async function writeRow(table, rowId, data) {
  const response = await api(`/tablesdb/${DATABASE_ID}/tables/${table}/rows`, {
    method: "POST",
    body: JSON.stringify({ rowId, data })
  });
  if (!response.ok) throw new Error(`${table} write ${response.status}`);
  return response.json();
}

async function patchRow(table, rowId, data) {
  const response = await api(`/tablesdb/${DATABASE_ID}/tables/${table}/rows/${rowId}`, {
    method: "PATCH",
    body: JSON.stringify({ data })
  });
  if (!response.ok) throw new Error(`${table} update ${response.status}`);
  return response.json();
}

function nowIso() {
  return new Date().toISOString();
}

/** Round-trip the caller's IP into a bucket that cannot be reversed usefully. */
async function ipBucket(req, body) {
  const headers = headersOf(req);
  const source = body.ipBucket ||
    headers["x-forwarded-for"] ||
    headers["x-real-ip"] ||
    "unknown";
  return (await sha256Hex(String(source).split(",")[0].trim())).slice(0, 24);
}

function validBbox(value) {
  if (!value || typeof value !== "object") return null;
  const numbers = [value.west, value.south, value.east, value.north];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [west, south, east, north] = numbers;
  if (west < -180 || east > 180 || south < -90 || south > 90) return null;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

/* ------------------------------------------------------------------ *
 * Referrals
 * ------------------------------------------------------------------ *
 *
 * A referrer earns 60% of every placement payment a shop they introduced
 * makes. The split, the amount and the rate are all computed here from the
 * placement row itself — a client can never submit an amount, and an earning
 * row can only be created by this function after a payment reference lands.
 *
 * Territory gate: this is Nepal-only for now. The client is never trusted to
 * decide. A claim is accepted only when the server resolves the reported
 * coordinates inside Nepal AND the payout account is a Nepali wallet
 * (eSewa / Khalti / IME Pay). The wallet is the real gate — a spoofed GPS
 * cannot collect money without a Nepali account, which needs Nepali KYC.
 */

const REFERRAL_SHARE = 0.6;
const REFERRAL_MIN_PAYOUT_MICRO = 100_000; // $0.10
const REFERRAL_TERRITORIES = ["NP"];
/**
 * 30-day maturity window on referral commissions.
 *
 * When a referred shop buys or renews Hodos software service, the 60%
 * commission is credited immediately into the referrer's account so they can
 * see every rupee/dollar they earned right away, and each credit matures for
 * cashout 30 days (1 month) after the shop's payment is recorded.
 */
const REFERRAL_MATURITY_DAYS = 30;
const REFERRAL_MATURITY_MS = REFERRAL_MATURITY_DAYS * DAY_MS;

// Coarse but honest: Nepal's bounding box, then a set of exclusions for the
// neighbouring corners of India and China that fall inside that box.
const NEPAL_BOX = { west: 80.05, south: 26.35, east: 88.2, north: 30.45 };

const NEPAL_EXCLUSIONS = [
  // Far-west/east corners of the box that belong to India.
  { west: 80.05, south: 26.35, east: 80.9, north: 28.1 },
  { west: 87.4, south: 26.35, east: 88.2, north: 26.9 },
  // The Tibetan plateau corner north of the Himalaya.
  { west: 80.05, south: 30.0, east: 88.2, north: 30.45 }
];

function insideBox(lat, lng, box) {
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}

/** Server-side territory decision. Coordinates outside Nepal are refused. */
function isNepalCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!insideBox(lat, lng, NEPAL_BOX)) return false;
  return !NEPAL_EXCLUSIONS.some((box) => insideBox(lat, lng, box));
}

const PAYOUT_METHODS = {
  esewa: { country: "NP", label: "eSewa" },
  khalti: { country: "NP", label: "Khalti" },
  imepay: { country: "NP", label: "IME Pay" }
};

function normalizePayout(body) {
  const method = String(body.payoutMethod || "").toLowerCase().trim();
  const account = String(body.payoutAccount || "").trim();
  const rule = PAYOUT_METHODS[method];
  if (!rule) return null;
  if (account.length < 6 || account.length > 120) return null;
  return { method, account, country: rule.country, label: rule.label };
}

/**
 * A shop can only ever be referred once, by one person, forever. The claim is
 * keyed on the shop's own identity (normalised name + coarse position), so a
 * re-submitted or re-worded placement cannot farm the same shop twice. The
 * `shopKey` column carries a unique index: a second claim fails at the database.
 */
function shopKeyFor(shop) {
  const name = String(shop.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const lat = (Math.round(Number(shop.lat) * 1000) / 1000).toFixed(3);
  const lng = (Math.round(Number(shop.lng) * 1000) / 1000).toFixed(3);
  return `${name}|${lat}|${lng}`.slice(0, 120);
}

/**
 * Records which referrer introduced a shop, exactly once. Returns the code that
 * actually owns the shop: the original claimer if it was already claimed.
 */
async function claimShopReferral(code, shop, placementId) {
  const shopKey = shopKeyFor(shop);
  const id = shopKey.replace(/[^a-z0-9]/g, "").slice(0, 24) || "shop";

  let existing = null;
  try {
    existing = await readRow("partnerReferrals", id);
  } catch (_) {
    existing = null;
  }
  if (existing) {
    // Already referred by someone. The original referrer keeps the shop.
    return { code: existing.code, alreadyClaimed: true };
  }

  try {
    await writeRow("partnerReferrals", id, {
      code,
      shopKey,
      shopName: String(shop.name || "").slice(0, 80),
      placementId,
      claimedAt: nowIso()
    });
  } catch (error) {
    // Lost the race: read back whoever won rather than double-crediting.
    log(`shop claim race for ${id}: ${error}`);
    const winner = await readRow("partnerReferrals", id).catch(() => null);
    return winner ? { code: winner.code, alreadyClaimed: true } : null;
  }
  return { code, alreadyClaimed: false };
}

/** The referrer an existing shop already belongs to, if any. */
async function referralOwnerOf(shop) {
  const shopKey = shopKeyFor(shop);
  const id = shopKey.replace(/[^a-z0-9]/g, "").slice(0, 24) || "shop";
  try {
    const row = await readRow("partnerReferrals", id);
    return row ? String(row.code || "") : "";
  } catch (_) {
    return "";
  }
}

function validReferralCode(value) {
  return typeof value === "string" && /^[a-z0-9]{6,24}$/.test(value);
}

function makeReferralCode(seed) {
  // Unambiguous alphabet: no 0/O or 1/I, so a code can be read off a card.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return (String(seed || "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 4) + out).slice(0, 12);
}

/**
 * The public shape of a referral. The payout account is deliberately partial:
 * enough for the owner to recognise their own wallet, never enough to leak it.
 */
function shapeReferral(row, totals) {
  const account = String(row.payoutAccount || "");
  const masked = account.length > 4
    ? `${"•".repeat(Math.max(0, account.length - 4))}${account.slice(-4)}`
    : "•".repeat(account.length);
  const earnedMicro = totals?.earnedMicro || 0;
  const paidMicro = totals?.paidMicro || 0;
  const owedMicro = totals?.owedMicro || 0;
  // Backwards-compatible: if maturedMicro is not supplied explicitly by a test,
  // treat the unpaid balance as matured unless pendingMicro was provided.
  const maturedMicro = typeof totals?.maturedMicro === "number"
    ? totals.maturedMicro
    : owedMicro;
  const pendingMicro = typeof totals?.pendingMicro === "number"
    ? totals.pendingMicro
    : Math.max(0, owedMicro - maturedMicro);
  return {
    code: row.code,
    ownerName: row.ownerName,
    country: row.country,
    payoutMethod: row.payoutMethod,
    payoutAccount: masked,
    share: REFERRAL_SHARE,
    maturityDays: REFERRAL_MATURITY_DAYS,
    disabled: Boolean(row.disabled),
    earnedMicro,
    earnedUsd: Number((earnedMicro / 1_000_000).toFixed(4)),
    paidMicro,
    paidUsd: Number((paidMicro / 1_000_000).toFixed(4)),
    owedMicro,
    owedUsd: Number((owedMicro / 1_000_000).toFixed(4)),
    maturedMicro,
    maturedUsd: Number((maturedMicro / 1_000_000).toFixed(4)),
    pendingMicro,
    pendingUsd: Number((pendingMicro / 1_000_000).toFixed(4)),
    nextCashoutAt: totals?.nextCashoutAt || null,
    available: maturedMicro >= REFERRAL_MIN_PAYOUT_MICRO,
    minPayoutUsd: REFERRAL_MIN_PAYOUT_MICRO / 1_000_000,
    referrals: totals?.placements || 0,
    history: Array.isArray(totals?.history) ? totals.history : []
  };
}

async function referralTotals(code) {
  const earnings = await readRows("referralEarnings", [
    { method: "equal", attribute: "code", values: [code] },
    { method: "limit", values: [5000] }
  ]);
  const payouts = await readRows("referralPayouts", [
    { method: "equal", attribute: "code", values: [code] },
    { method: "limit", values: [500] }
  ]);
  const now = Date.now();
  let earnedMicro = 0;
  let maturedEarnedMicro = 0;
  let nextMaturityMs = Infinity;
  const history = [];

  for (const row of earnings) {
    const micro = Number(row.microEarned) || 0;
    earnedMicro += micro;
    const createdMs = Date.parse(String(row.createdAt || row.$createdAt || ""));
    const maturesAtMs = Number.isFinite(createdMs)
      ? createdMs + REFERRAL_MATURITY_MS
      : now;
    const isMatured = maturesAtMs <= now;
    if (isMatured) {
      maturedEarnedMicro += micro;
    } else if (maturesAtMs < nextMaturityMs) {
      nextMaturityMs = maturesAtMs;
    }
    history.push({
      placementId: String(row.placementId || ""),
      reason: String(row.reason || "placement"),
      earnedUsd: Number((micro / 1_000_000).toFixed(4)),
      createdAt: row.createdAt || row.$createdAt || null,
      maturesAt: new Date(maturesAtMs).toISOString(),
      matured: isMatured
    });
  }

  // Only a settled payout reduces the balance. A requested one is still owed.
  const paidMicro = payouts
    .filter((row) => row.status === "settled")
    .reduce((sum, row) => sum + (Number(row.microAmount) || 0), 0);
  const owedMicro = Math.max(0, earnedMicro - paidMicro);
  const maturedMicro = Math.max(0, Math.min(owedMicro, maturedEarnedMicro - paidMicro));
  const pendingMicro = Math.max(0, owedMicro - maturedMicro);
  const placements = new Set(earnings.map((row) => row.placementId)).size;

  return {
    earnedMicro,
    paidMicro,
    owedMicro,
    maturedMicro,
    pendingMicro,
    nextCashoutAt: Number.isFinite(nextMaturityMs) ? new Date(nextMaturityMs).toISOString() : null,
    placements,
    history: history.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 20)
  };
}

/**
 * Writes one earning row per (code, placement, reason). The deterministic row
 * id is what makes a retry safe: a second call cannot double-credit a payment,
 * because the row already exists and the write is skipped.
 */
async function creditReferral(placement, code, microTotal, reason) {
  if (!validReferralCode(code)) return null;
  if (!Number.isFinite(microTotal) || microTotal <= 0) return null;

  let referral;
  try {
    referral = (await readRows("referrals", [
      { method: "equal", attribute: "code", values: [code] },
      { method: "limit", values: [1] }
    ]))[0];
  } catch (_) {
    return null;
  }
  if (!referral || referral.disabled === true) return null;

  const rowId = `${code.slice(0, 8)}_${String(placement).slice(0, 20)}_${reason}`.slice(0, 36);
  const earned = Math.round(microTotal * REFERRAL_SHARE);
  const platform = microTotal - earned;

  try {
    await writeRow("referralEarnings", rowId, {
      code,
      placementId: String(placement),
      microEarned: earned,
      microPlatform: platform,
      currency: "USD",
      reason,
      createdAt: nowIso()
    });
  } catch (error) {
    // A duplicate row id means this payment was already credited.
    log(`referral credit skipped for ${rowId}: ${error}`);
    return null;
  }
  return { code, earnedMicro: earned, platformMicro: platform };
}

/** Nepal-only, and the caller must prove it with coordinates and a wallet. */
function referralGate(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!isNepalCoordinate(lat, lng)) {
    return { ok: false, error: "referrals are available in Nepal only" };
  }
  const payout = normalizePayout(body);
  if (!payout) {
    return {
      ok: false,
      error: "a Nepali payout wallet is required (eSewa, Khalti or IME Pay)",
      methods: Object.keys(PAYOUT_METHODS)
    };
  }
  if (!REFERRAL_TERRITORIES.includes(payout.country)) {
    return { ok: false, error: "referrals are available in Nepal only" };
  }
  return { ok: true, payout };
}

async function referralCreate(body) {
  const gate = referralGate(body);
  if (!gate.ok) return gate;

  const ownerName = String(body.ownerName || "").trim();
  if (ownerName.length < 2 || ownerName.length > 80) {
    return { ok: false, error: "include the name to show on the referral" };
  }

  let code = makeReferralCode(ownerName);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const taken = await readRows("referrals", [
      { method: "equal", attribute: "code", values: [code] },
      { method: "limit", values: [1] }
    ]).catch(() => []);
    if (taken.length === 0) break;
    code = makeReferralCode(ownerName);
  }

  await writeRow("referrals", code, {
    code,
    ownerName,
    payoutMethod: gate.payout.method,
    payoutAccount: gate.payout.account,
    country: gate.payout.country,
    createdAt: nowIso(),
    disabled: false
  });

  return {
    ok: true,
    ...shapeReferral({
      code, ownerName,
      payoutMethod: gate.payout.method,
      payoutAccount: gate.payout.account,
      country: gate.payout.country,
      disabled: false
    }, { earnedMicro: 0, paidMicro: 0, owedMicro: 0, placements: 0 })
  };
}

async function referralProfile(body) {
  const code = String(body.code || "").trim().toLowerCase();
  if (!validReferralCode(code)) return { ok: false, error: "unknown referral" };
  const gate = referralGate(body);
  if (!gate.ok) return gate;

  let row;
  try {
    row = await readRow("referrals", code);
  } catch (_) {
    row = null;
  }
  if (!row) return { ok: false, error: "unknown referral" };

  const totals = await referralTotals(code);
  return { ok: true, ...shapeReferral(row, totals) };
}

async function referralRequestPayout(body) {
  const code = String(body.code || "").trim().toLowerCase();
  if (!validReferralCode(code)) return { ok: false, error: "unknown referral" };
  const gate = referralGate(body);
  if (!gate.ok) return gate;

  let row;
  try {
    row = await readRow("referrals", code);
  } catch (_) {
    row = null;
  }
  if (!row) return { ok: false, error: "unknown referral" };

  const totals = await referralTotals(code);
  if (totals.maturedMicro < REFERRAL_MIN_PAYOUT_MICRO) {
    if (totals.pendingMicro >= REFERRAL_MIN_PAYOUT_MICRO) {
      return {
        ok: false,
        error: `your earned balance ($${(totals.owedMicro / 1_000_000).toFixed(2)}) unlocks for cashout 30 days after the shop's payment`,
        owedUsd: Number((totals.owedMicro / 1_000_000).toFixed(4)),
        pendingUsd: Number((totals.pendingMicro / 1_000_000).toFixed(4)),
        nextCashoutAt: totals.nextCashoutAt
      };
    }
    return {
      ok: false,
      error: `the minimum payout is $${(REFERRAL_MIN_PAYOUT_MICRO / 1_000_000).toFixed(2)}`,
      owedUsd: Number((totals.owedMicro / 1_000_000).toFixed(4))
    };
  }

  const pending = await readRows("referralPayouts", [
    { method: "equal", attribute: "code", values: [code] },
    { method: "equal", attribute: "status", values: ["requested"] },
    { method: "limit", values: [1] }
  ]);
  if (pending.length > 0) {
    return { ok: false, error: "a payout is already being processed" };
  }

  const id = `rq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await writeRow("referralPayouts", id, {
    code,
    microAmount: totals.maturedMicro,
    payoutMethod: row.payoutMethod,
    payoutAccount: row.payoutAccount,
    status: "requested",
    requestedAt: nowIso()
  });

  return {
    ok: true,
    requestId: id,
    amountUsd: Number((totals.maturedMicro / 1_000_000).toFixed(4)),
    payoutMethod: row.payoutMethod,
    next: "Cashout requested. Matured referral commissions are settled to your Nepali wallet."
  };
}


/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

function shapeHazard(row) {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: row.$id,
    kind: row.kind || "pothole",
    severity: Number(row.severity) || 0,
    lat,
    lng,
    passes: Number(row.passes) || 0,
    fixed: Boolean(row.fixed),
    lastSeen: row.$updatedAt || null
  };
}

/** Live shop pins inside a box, minus anything past its paid expiry. */
async function liveShops(bbox, cap = 12) {
  const rows = await readRows("partners", [{ method: "limit", values: [PAGE] }]);
  const now = Date.now();
  const shops = [];
  for (const row of rows) {
    const until = Date.parse(String(row.activeUntil || ""));
    if (Number.isFinite(until) && until < now) continue;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (bbox && (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east)) {
      continue;
    }
    shops.push({
      id: row.$id,
      name: String(row.name || "").slice(0, 80),
      category: row.category || "business",
      lat,
      lng,
      offer: String(row.offer || "").slice(0, 160),
      address: typeof row.address === "string" && row.address ? row.address.slice(0, 160) : null,
      // Contact reaches the assistant only in the form the shop chose: a phone
      // number or an email it published for exactly this purpose.
      phone: typeof row.phone === "string" && row.phone ? row.phone : null,
      email: typeof row.email === "string" && row.email ? row.email : null,
      link: typeof row.link === "string" && row.link ? row.link : null
    });
    if (shops.length >= cap) break;
  }
  return shops;
}

async function hazards(body) {
  const bbox = validBbox(body.bbox);
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), PAGE);
  const rows = await readRows("hazards", [{ method: "limit", values: [PAGE] }]);
  const shaped = rows.map(shapeHazard).filter(Boolean);
  const filtered = bbox
    ? shaped.filter((h) => h.lat >= bbox.south && h.lat <= bbox.north &&
        h.lng >= bbox.west && h.lng <= bbox.east)
    : shaped;
  return {
    count: filtered.length,
    returned: Math.min(filtered.length, limit),
    bbox,
    hazards: filtered.slice(0, limit),
    // Shops that paid to be here are surfaced alongside the road data, so an
    // assistant answering "where can I fix this" has a real name to give.
    shops: bbox ? await liveShops(bbox) : []
  };
}

async function roads(body) {
  const bbox = validBbox(body.bbox);
  const rows = await readRows("hazards", [{ method: "limit", values: [PAGE] }]);
  const cells = new Map();
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (bbox && (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east)) {
      continue;
    }
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cell = cells.get(key) || { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)), hazards: 0, severity: 0 };
    cell.hazards += 1;
    cell.severity += Number(row.severity) || 0;
    cells.set(key, cell);
  }
  const out = [...cells.values()].map((cell) => ({
    lat: cell.lat,
    lng: cell.lng,
    hazards: cell.hazards,
    meanSeverity: Number((cell.severity / cell.hazards).toFixed(2))
  }));
  return { bbox, cells: out.length, roads: out, shops: bbox ? await liveShops(bbox) : [] };
}

/**
 * Partner shops, mirroring the web app's own list.
 *
 * The links carry no product data, so this returns shops and what they sell, not
 * invented prices. Only shops with a configured link are returned.
 */
const PARTNER_SHOPS = [
  { key: "woopdrive", name: "WoopDrive", category: "Travel", blurb: "Car hire for a road trip.", url: "https://dkfrh.com/g/ffzns2ktmfecd1928bc8d80355ec70/" },
  { key: "flyfi", name: "Flyfi", category: "Travel", blurb: "Hotels and stays.", url: "https://xcdus.com/g/0xtgjon8aeecd1928bc8a2e4f55a9f/" },
  { key: "avitovip", name: "AvitoVIP", category: "Travel", blurb: "Fixed-price airport transfers in Turkey.", url: "https://kjuzv.com/g/02swkf5uv6ecd1928bc8babf13962c/", regions: ["TR"] },
  { key: "compensair", name: "Compensair", category: "Money back", blurb: "Flight delay and cancellation compensation.", url: "https://dbnua.com/g/5k6m2qm7z5ecd1928bc890465e1588/" },
  { key: "lennuabi", name: "Lennuabi", category: "Money back", blurb: "EU flight compensation up to €600.", url: "https://cafxq.com/g/913bhutj0zecd1928bc8a8b9cbb737/", regions: ["EE", "LV", "LT", "FI", "SE", "DE", "FR", "ES", "IT", "NL", "PL", "IE"] },
  { key: "redmagic", name: "REDMAGIC", category: "Tech", blurb: "Gaming phones and mobile hardware.", url: "https://yyczo.com/g/qmttmvxh1uecd1928bc856637026d8/" },
  { key: "bewakoof", name: "Bewakoof", category: "Style", blurb: "Street basics, shipped in India.", url: "https://tjzuh.com/g/el5arbwariecd1928bc88f3bde6dea/", regions: ["IN"] },
  { key: "hellomolly", name: "Hello Molly", category: "Style", blurb: "Occasion wear, worldwide.", url: "https://ntzgd.com/g/v4mbsetakjecd1928bc85fd6c9cc83/" },
  { key: "chicme", name: "ChicMe", category: "Style", blurb: "Everyday womenswear.", url: "https://rzekl.com/g/gf807z8tarecd1928bc8312b8f391a/" },
  { key: "versace", name: "Palazzo Versace", category: "Travel", blurb: "A Dubai stopover hotel.", url: "https://xmknb.com/g/6z621dqopyecd1928bc8080b20079f/", regions: ["AE"] }
];

async function garage(body) {
  const country = String(body.country || "").toUpperCase().slice(0, 2);
  // In Nepal, the Garage serves the live shops that actually placed a pin on
  // the map, never generic affiliate links.
  if (country === "NP") {
    const shops = await liveShops(null, PAGE);
    return { country: "NP", mode: "nepal-map-shops", count: shops.length, shops };
  }
  const shops = PARTNER_SHOPS.filter((shop) => !shop.regions || (country && shop.regions.includes(country)));
  return { country: country || null, mode: "affiliate", count: shops.length, shops };
}

async function partners(body) {
  const bbox = validBbox(body.bbox);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), PAGE);
  const shops = await liveShops(bbox, limit);
  return { bbox, count: shops.length, shops };
}

async function graph(body) {
  const bbox = validBbox(body.bbox);
  const rows = await readRows("hazards", [{ method: "limit", values: [PAGE] }]);
  const byDay = new Map();
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (bbox && (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east)) {
      continue;
    }
    const seen = String(row.$updatedAt || row.$createdAt || "").slice(0, 10) || "unknown";
    const bucket = byDay.get(seen) || { day: seen, hazards: 0, severity: 0 };
    bucket.hazards += 1;
    bucket.severity += Number(row.severity) || 0;
    byDay.set(seen, bucket);
  }
  return {
    bbox,
    series: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  };
}

/* ------------------------------------------------------------------ *
 * Metering
 * ------------------------------------------------------------------ */

async function startKey(apiKey) {
  if (!apiKey || apiKey.length < 16) return { error: "missing key" };
  const id = await keyId(apiKey);
  const response = await api(`/tablesdb/${DATABASE_ID}/tables/apiKeys/rows/${id}`);
  if (response.status === 404) return { error: "unknown key" };
  if (!response.ok) throw new Error(`key read ${response.status}`);
  const row = await response.json();
  if (row.disabled) return { error: "key disabled" };
  return { id, row, prefix: id.slice(0, 8) };
}

async function charge(account, action) {
  const cost = PRICES[action] || 0;
  if (cost === 0) return { cost: 0, remaining: Number(account.row.creditsMicro) || 0 };
  const balance = Number(account.row.creditsMicro) || 0;
  if (balance < cost) return { insufficient: true, cost, remaining: balance };
  const remaining = balance - cost;
  await patchRow("apiKeys", account.id, {
    creditsMicro: remaining,
    lastUsedAt: nowIso()
  });
  await writeRow("apiUsage", `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, {
    keyPrefix: account.prefix,
    action,
    costMicro: cost,
    at: nowIso()
  });
  return { cost, remaining };
}

/** File an error or a fix suggestion so maintainers see it without being told. */
async function fileReport(entry) {
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await writeRow("agentReports", id, {
    kind: String(entry.kind || "error").slice(0, 24),
    message: String(entry.message || "").slice(0, 2000),
    action: String(entry.action || "").slice(0, 32),
    agent: String(entry.agent || "").slice(0, 80),
    prompt: String(entry.prompt || "").slice(0, 4000),
    environment: String(entry.environment || "").slice(0, 200),
    keyPrefix: String(entry.keyPrefix || "").slice(0, 12),
    at: nowIso()
  });
  return id;
}

/* ------------------------------------------------------------------ *
 * Partner placements
 * ------------------------------------------------------------------ */

let fxCache = { rates: null, at: 0 };

/** Live USD rates, cached for half a day, with a regional fallback table. */
async function usdRates() {
  if (fxCache.rates && Date.now() - fxCache.at < FX_TTL_MS) return fxCache.rates;
  try {
    const response = await fetch(FX_URL, { signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const body = await response.json();
      if (body && body.rates && typeof body.rates.USD === "number") {
        fxCache = { rates: body.rates, at: Date.now() };
        return fxCache.rates;
      }
    }
  } catch (_) {
    // A stale rate is better than no number; the fallback table covers the
    // currencies this offer is most often bought in.
  }
  return FX_FALLBACK;
}

/**
 * Resolve a currency from what the caller actually knows: a locale tag like
 * `ne-NP`, or a bare country code. No IP lookup, no precise location.
 */
function currencyFor(locale, requested) {
  if (typeof requested === "string" && /^[A-Za-z]{3}$/.test(requested)) {
    return requested.toUpperCase();
  }
  const tag = String(locale || "").trim();
  const parts = tag.replace("_", "-").split("-");
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const region = parts[i].toUpperCase();
    if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  }
  if (REGION_CURRENCY[parts[0].toUpperCase()]) return REGION_CURRENCY[parts[0].toUpperCase()];
  return "USD";
}

/** The ISO country the caller is in, from a locale tag only. No IP lookup. */
function countryFor(locale, requested) {
  if (typeof requested === "string" && /^[A-Za-z]{2}$/.test(requested)) {
    return requested.toUpperCase();
  }
  const parts = String(locale || "").trim().replace("_", "-").split("-");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (/^[A-Za-z]{2}$/.test(parts[i]) && i > 0) return parts[i].toUpperCase();
  }
  return "";
}

/** Country -> pricing tier. Unlisted countries are sold at the standard tier. */
function tierFor(country) {
  for (const [tier, countries] of Object.entries(COUNTRY_TIER)) {
    if (countries.includes(country)) return tier;
  }
  return "high";
}

function roundMoney(value, currency) {
  const zeroDecimal = ["JPY", "KRW", "VND", "IDR", "UGX", "TZS", "CLP", "PYG"];
  if (zeroDecimal.includes(currency)) return Math.round(value);
  const rounded = Math.round(value * 100) / 100;
  return rounded >= 1 ? rounded : Math.round(value * 1000) / 1000;
}

/**
 * Duration discount ladder: base rate is for 1 day, and longer commitments get a
 * progressively lower effective daily rate (1 day > 3 > 7 > 14 > 30 > 90 > 180 > 365).
 */
function durationFactor(days) {
  if (days >= 365) return 0.6;
  if (days >= 180) return 0.7;
  if (days >= 90) return 0.78;
  if (days >= 30) return 0.85;
  if (days >= 14) return 0.9;
  if (days >= 7) return 0.93;
  if (days >= 3) return 0.97;
  return 1;
}

async function partnerQuote(body) {
  const country = countryFor(body.locale, body.countryCode || body.country);
  const currency = currencyFor(body.locale, body.currency);
  const tier = tierFor(country);
  const rates = await usdRates();
  const rate = Number(rates[currency]) || 1;
  const days = clampDays(body.days);
  const baseUsdPerDay = PARTNER_TIERS[tier].usdPerDay;
  const factor = durationFactor(days);
  const discountPct = Math.round((1 - factor) * 100);
  const usdPerDay = roundMoney(baseUsdPerDay * factor, "USD");
  const baseLocalPerDay = roundMoney(baseUsdPerDay * rate, currency);
  const perDay = roundMoney(baseUsdPerDay * rate * factor, currency);
  const week = roundMoney(baseUsdPerDay * rate * durationFactor(7) * 7, currency);
  return {
    country: country || null,
    tier,
    currency,
    baseUsdPerDay,
    usdPerDay,
    baseLocalPerDay,
    localPerDay: perDay,
    discountPct,
    weeksFrom: week,
    days,
    totalLocal: roundMoney(perDay * days, currency),
    totalUsd: roundMoney(usdPerDay * days, "USD"),
    tiers: Object.fromEntries(
      Object.entries(PARTNER_TIERS).map(([name, value]) => [name, value.usdPerDay])
    ),
    // Pay with what the shop actually has. We never publish our wallet IDs on a
    // public page: the shop emails us for the eSewa, Khalti or IME Pay details,
    // sends the payment, and submits the transaction reference here.
    settlement: country === "NP"
      ? "Email hodos@devilabs.dev for our eSewa, Khalti, IME Pay or bank transfer details, then enter your transaction ID through partnerPlace so the pin goes live immediately."
      : "Pay by Payoneer, card or PayPal. Send the reference through partnerPlace; the pin goes live once it clears.",
    settlementOptions: country === "NP"
      ? ["esewa", "khalti", "imepay", "bank"]
      : ["payoneer", "card", "paypal"],
    note: "One shop, one pin, one line of text. Never over the route ahead."
  };
}

function clampDays(value) {
  const days = Math.round(Number(value) || 1);
  return Math.min(Math.max(days, 1), PARTNER_MAX_DAYS);
}

/**
 * Two shops cannot occupy the same spot. A second pin at (or within a few
 * metres of) an existing one is refused rather than stacked invisibly on top —
 * otherwise the map shows one marker where two shops paid for visibility.
 */
const PIN_MIN_SEPARATION_M = 8;

function metresBetween(a, b) {
  const earth = 6_371_008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Returns the live pin already occupying this spot, if any. */
async function pinAt(shop) {
  let rows = [];
  try {
    rows = await readRows("partners", [{ method: "limit", values: [500] }]);
  } catch (_) {
    return null;
  }
  const now = Date.now();
  for (const row of rows) {
    const until = Date.parse(String(row.activeUntil || ""));
    if (Number.isFinite(until) && until < now) continue;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (metresBetween(shop, { lat, lng }) <= PIN_MIN_SEPARATION_M) {
      return { id: row.$id, name: String(row.name || "") };
    }
  }
  return null;
}

/**
 * Strict validation for every placement, trial included.
 *
 * A public pin is a promise to a driver and to the assistants that read this
 * API: a real shop, that can actually be found, and reached. "Some name on a
 * random point" is refused.
 */
const SHOP_NAME_MIN = 3;
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function normalisePhone(raw) {
  const cleaned = String(raw || "").replace(/[()\s-]/g, "");
  return PHONE_RE.test(cleaned) ? cleaned.slice(0, 20) : "";
}

function validPartner(body) {
  const name = String(body.name || "").trim();
  const offer = String(body.offer || "").trim();
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  // Name: present, not a placeholder, and long enough to identify a shop.
  if (name.length < SHOP_NAME_MIN || name.length > 80) {
    return { error: "give the shop's real name" };
  }
  if (!/[a-z\u0900-\u097F]{2}/i.test(name)) {
    return { error: "give the shop's real name" };
  }

  // One line: what a driver actually gets there.
  if (offer.length < 8 || offer.length > 160) {
    return { error: "describe in one line what the shop offers (at least 8 characters)" };
  }

  // Position: a real point on Earth, never 0,0 or a rounded-off guess.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "place the pin on the shop" };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "place the pin on the shop" };
  }
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
    return { error: "place the pin on the shop" };
  }

  // Contact: mandatory, because a placement nobody can verify is not a shop.
  // Either a phone number or an email, and it must look like one.
  const phone = normalisePhone(body.phone || body.contact);
  const email = EMAIL_RE.test(String(body.email || "").trim())
    ? String(body.email).trim().slice(0, 254)
    : "";
  // A placement nobody can call is not a shop. The phone number is mandatory for
  // every placement, trial included, and must look like a real one.
  if (!phone) {
    return { error: "a phone number is required so we can reach the shop" };
  }
  if (String(body.email || "").trim() && !email) {
    return { error: "that email address does not look complete" };
  }

  // Address: the street the shop is on, so a driver can find the door.
  const address = String(body.address || "").trim();
  if (address.length < 5 || address.length > 160) {
    return { error: "include the street address of the shop" };
  }

  let link = "";
  if (typeof body.link === "string" && body.link.trim()) {
    try {
      const parsed = new URL(body.link.trim());
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        link = parsed.toString().slice(0, 200);
      } else {
        return { error: "the link must start with https://" };
      }
    } catch (_) {
      return { error: "the link is not a valid URL" };
    }
  }

  return {
    shop: {
      name,
      offer,
      lat,
      lng,
      category: String(body.category || "business").slice(0, 32),
      contact: phone ? `tel:${phone}` : `mailto:${email}`,
      phone,
      email,
      address,
      link
    }
  };
}

/**
 * Adds paid days to a placement. The pin only exists once payment has cleared,
 * so there is no free day and no unpaid "reserved" state: an extension either
 * belongs to a live pin (it moves the expiry forward) or to a placement that
 * has not settled yet (it only grows the amount owed).
 */
async function partnerStatus(body) {
  const id = String(body.placement || "").trim();
  if (!/^p[a-z0-9]{6,24}$/i.test(id)) return { ok: false, error: "unknown placement" };

  let order;
  try {
    order = await readRow("partnerPlacements", id);
  } catch (_) {
    order = null;
  }
  if (!order) return { ok: false, error: "unknown placement" };

  let pin = null;
  try {
    pin = await readRow("partners", id);
  } catch (_) {
    pin = null;
  }

  const activeUntil = pin && pin.activeUntil ? String(pin.activeUntil) : null;
  const untilMs = activeUntil ? Date.parse(activeUntil) : NaN;
  const live = Boolean(pin && (!Number.isFinite(untilMs) || untilMs >= Date.now()));

  const month = new Date().toISOString().slice(0, 7);
  let passesThisMonth = 0;
  try {
    const statsRows = await readRows("partnerStats", [
      { method: "equal", attribute: "partnerId", values: [id] },
      { method: "equal", attribute: "month", values: [month] },
      { method: "limit", values: [1] }
    ]);
    if (statsRows[0]) {
      passesThisMonth = Math.max(0, Number(statsRows[0].uniqueDevices) || 0);
    }
  } catch (_) {
    passesThisMonth = 0;
  }

  return {
    ok: true,
    placement: id,
    name: String(order.name || ""),
    category: String(order.category || "business"),
    offer: String(order.offer || ""),
    status: String(order.status || ""),
    days: Number(order.days) || 1,
    live,
    activeUntil,
    month,
    passesThisMonth
  };
}

async function partnerExtend(req, body) {
  const id = String(body.placement || "").trim();
  if (!/^p[a-z0-9]{6,24}$/i.test(id)) return { ok: false, error: "unknown placement" };

  let order;
  try {
    order = await readRow("partnerPlacements", id);
  } catch (_) {
    order = null;
  }
  if (!order) return { ok: false, error: "unknown placement" };

  const days = clampDays(body.days);
  const quote = await partnerQuote({ ...body, days });
  const addMicro = Math.round(quote.usdPerDay * 1_000_000) * days;

  let pin = null;
  try {
    pin = await readRow("partners", id);
  } catch (_) {
    pin = null;
  }

  const totalDays = (Number(order.days) || 1) + days;
  const owedMicro = (Number(order.amountMicro) || 0) + addMicro;

  // Payment recorded for the added days: the pin goes (or stays) live.
  const reference = String(body.reference || "").trim();
  if (reference) {
    const currentUntil = pin ? Date.parse(String(pin.activeUntil || "")) : NaN;
    const from = Number.isFinite(currentUntil) && currentUntil > Date.now() ? currentUntil : Date.now();
    const activeUntil = new Date(from + days * DAY_MS).toISOString();

    if (pin) {
      await patchRow("partners", id, { activeUntil });
    } else {
      await writeRow("partners", id, {
        name: order.name,
        category: order.category || "business",
        lat: order.lat,
        lng: order.lng,
        offer: order.offer || "",
        sponsorLabel: "Local shop",
        phone: order.phone || "",
        email: order.email || "",
        address: order.address || "",
        link: order.link || "",
        contact: order.contact || "",
        activeUntil
      });
    }

    await patchRow("partnerPlacements", id, {
      days: totalDays,
      amountMicro: owedMicro,
      reference,
      status: "pending",
      paidAt: nowIso()
    });

    // Each paid extension is its own earning, keyed by its amount so a retry
    // of the same extension cannot credit twice.
    let referral = null;
    const referrer = String(order.referredBy || "").trim().toLowerCase();
    if (referrer) {
      referral = await creditReferral(id, referrer, addMicro, `extend${addMicro}`)
        .catch((error) => { log(`referral credit failed: ${error}`); return null; });
    }

    return {
      ok: true,
      placement: id,
      status: "pending",
      live: true,
      activeUntil,
      days: totalDays,
      addedDays: days,
      owedMicro: 0,
      owedUsd: 0,
      currency: quote.currency,
      referral: referral ? { code: referral.code, earnedUsd: Number((referral.earnedMicro / 1_000_000).toFixed(4)) } : null,
      next: `Payment reference recorded. The pin is live until ${activeUntil}.`
    };
  }

  // No payment with the extension: the placement stays unpaid and the map is
  // untouched. A pin that is not paid for never appears.
  await patchRow("partnerPlacements", id, {
    days: totalDays,
    amountMicro: owedMicro,
    status: "awaiting-payment"
  });

  return {
    ok: true,
    placement: id,
    status: "awaiting-payment",
    live: false,
    activeUntil: null,
    days: totalDays,
    addedDays: days,
    owedMicro,
    owedUsd: Number((owedMicro / 1_000_000).toFixed(4)),
    currency: quote.currency,
    owedLocal: quote.localPerDay * totalDays,
    next: `Send a payment reference of ${money(owedMicro, quote.currency)} to publish this pin.`
  };
}

function mintOwnerKey() {
  return `hsk_${[...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function hashOwnerKey(placementId, manageKey) {
  return (await sha256Hex(`${String(placementId || "").trim()}:${String(manageKey || "").trim()}`)).slice(0, 40);
}

function constantTimeEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (!sa || sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

function extractOwnerKeyHash(reference) {
  const m = String(reference || "").match(/(?:^|\|)ok:([a-f0-9]{40})(?:\||$)/i);
  return m ? m[1].toLowerCase() : "";
}

function extractExtensionRequest(reference) {
  const m = String(reference || "").match(/(?:^|\|)ext:\+(\d+)d@([0-9T:\-.Z]+)(?:\||$)/);
  return m ? { days: Number(m[1]), requestedAt: m[2] } : null;
}

function encodeReferenceWithOwnerHash(baseRef, ownerHash, extTag = "") {
  const cleanBase = String(baseRef || "free")
    .replace(/\|ok:[a-f0-9]+/gi, "")
    .replace(/\|ext:[^|]+/gi, "")
    .trim()
    .slice(0, 28) || "free";
  const parts = [cleanBase, `ok:${ownerHash}`];
  if (extTag) parts.push(`ext:${extTag}`);
  return parts.join("|").slice(0, 120);
}

async function verifyOwnerKey(placementId, manageKey, order) {
  const key = String(manageKey || "").trim();
  if (!key || key.length < 16 || !order) return false;
  const storedHash = extractOwnerKeyHash(order.reference);
  if (!storedHash) return false;
  const candidate = await hashOwnerKey(placementId, key);
  return constantTimeEqual(storedHash, candidate);
}

async function partnerPortal(body) {
  const id = String(body.placement || "").trim();
  const manageKey = String(body.manageKey || "").trim();
  if (!/^[a-z0-9_-]{6,36}$/i.test(id) || manageKey.length < 16) {
    return { ok: false, status: 401, error: "enter both your Pin Reference ID and Owner Secret Key" };
  }

  let order = null;
  try {
    order = await readRow("partnerPlacements", id);
  } catch (_) {
    order = null;
  }
  if (!order) return { ok: false, status: 404, error: "unknown pin reference ID" };

  if (!(await verifyOwnerKey(id, manageKey, order))) {
    return { ok: false, status: 401, error: "invalid owner secret key for this pin" };
  }

  let pin = null;
  try {
    pin = await readRow("partners", id);
  } catch (_) {
    pin = null;
  }

  const activeUntil = pin && pin.activeUntil ? String(pin.activeUntil) : null;
  const untilMs = activeUntil ? Date.parse(activeUntil) : NaN;
  const now = Date.now();
  const live = Boolean(pin && (!Number.isFinite(untilMs) || untilMs >= now));
  const daysRemaining = live && Number.isFinite(untilMs)
    ? Math.max(0, Math.ceil((untilMs - now) / DAY_MS))
    : 0;

  const month = new Date().toISOString().slice(0, 7);
  let passesThisMonth = 0;
  let monthlyPasses = [];
  try {
    const statsRows = await readRows("partnerStats", [
      { method: "equal", attribute: "partnerId", values: [id] },
      { method: "limit", values: [12] }
    ]);
    monthlyPasses = statsRows
      .filter((r) => typeof r.month === "string" && /^\d{4}-\d{2}$/.test(r.month))
      .map((r) => ({ month: String(r.month), passes: Math.max(0, Number(r.passes) || 0) }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6);
    const current = monthlyPasses.find((m) => m.month === month);
    if (current) passesThisMonth = current.passes;
  } catch (_) {
    // partnerStats is optional until aggregated
  }
  if (!monthlyPasses.some((m) => m.month === month)) {
    monthlyPasses = [...monthlyPasses.slice(-5), { month, passes: passesThisMonth }];
  }

  const lat = Number(pin?.lat ?? order.lat);
  const lng = Number(pin?.lng ?? order.lng);
  let nearbyHazardsCount = 0;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const degPad = 0.005;
      const hazardRows = await readRows("hazards", [
        { method: "greaterThanEqual", attribute: "lat", values: [lat - degPad] },
        { method: "lessThanEqual", attribute: "lat", values: [lat + degPad] },
        { method: "limit", values: [100] }
      ]);
      nearbyHazardsCount = hazardRows.filter((h) => {
        if (!h.published) return false;
        const hLat = Number(h.lat);
        const hLng = Number(h.lng);
        if (!Number.isFinite(hLat) || !Number.isFinite(hLng)) return false;
        return metresBetween({ lat, lng }, { lat: hLat, lng: hLng }) <= 500;
      }).length;
    } catch (_) {
      nearbyHazardsCount = 0;
    }
  }

  return {
    ok: true,
    placement: id,
    name: String(pin?.name || order.name || ""),
    category: String(pin?.category || order.category || "business"),
    offer: String(pin?.offer || order.offer || ""),
    link: String(pin?.link || order.link || ""),
    address: String(pin?.address || ""),
    phone: String(pin?.phone || ""),
    lat,
    lng,
    live,
    status: String(order.status || (live ? "active" : "expired")),
    activeUntil,
    days: Number(order.days) || 1,
    daysRemaining,
    createdAt: String(order.at || ""),
    month,
    passesThisMonth,
    monthlyPasses,
    nearbyHazardsCount,
    pendingExtension: extractExtensionRequest(order.reference),
    apiDiscovery: {
      enabled: live,
      endpoints: ["partners", "hazards", "roads"]
    }
  };
}

async function partnerUpdate(body) {
  const id = String(body.placement || "").trim();
  const manageKey = String(body.manageKey || "").trim();
  if (!/^[a-z0-9_-]{6,36}$/i.test(id) || manageKey.length < 16) {
    return { ok: false, status: 401, error: "missing pin ID or owner secret key" };
  }

  let order = null;
  try {
    order = await readRow("partnerPlacements", id);
  } catch (_) {
    order = null;
  }
  if (!order) return { ok: false, status: 404, error: "unknown pin reference ID" };

  if (!(await verifyOwnerKey(id, manageKey, order))) {
    return { ok: false, status: 401, error: "invalid owner secret key for this pin" };
  }

  const offer = String(body.offer || "").trim().slice(0, 160);
  if (offer.length < 8) {
    return { ok: false, status: 400, error: "describe your offer or shop line in at least 8 characters" };
  }
  const category = String(body.category || order.category || "business").trim().slice(0, 40) || "business";
  const rawLink = String(body.link || "").trim().slice(0, 200);
  let link = "";
  if (rawLink) {
    try {
      const parsed = new URL(rawLink);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, status: 400, error: "website link must start with http:// or https://" };
      }
      link = parsed.href;
    } catch (_) {
      return { ok: false, status: 400, error: "enter a valid website URL" };
    }
  }
  const phone = String(body.phone || "").trim().slice(0, 40);
  if (phone) {
    const digits = phone.replace(/[()\s-]/g, "");
    if (!/^\+?[0-9][0-9\s-]{6,19}$/.test(digits)) {
      return { ok: false, status: 400, error: "enter a valid phone number" };
    }
  }

  await patchRow("partnerPlacements", id, { offer, category, link });
  try {
    const pinPatch = { offer, category, link };
    if (phone) pinPatch.phone = phone;
    await patchRow("partners", id, pinPatch);
  } catch (_) {
    // Pin may have expired; placement record is still updated.
  }

  return {
    ok: true,
    placement: id,
    updated: { offer, category, link, phone }
  };
}

async function partnerRequestDays(body) {
  const id = String(body.placement || "").trim();
  const manageKey = String(body.manageKey || "").trim();
  if (!/^[a-z0-9_-]{6,36}$/i.test(id) || manageKey.length < 16) {
    return { ok: false, status: 401, error: "missing pin ID or owner secret key" };
  }

  let order = null;
  try {
    order = await readRow("partnerPlacements", id);
  } catch (_) {
    order = null;
  }
  if (!order) return { ok: false, status: 404, error: "unknown pin reference ID" };

  if (!(await verifyOwnerKey(id, manageKey, order))) {
    return { ok: false, status: 401, error: "invalid owner secret key for this pin" };
  }

  const days = clampDays(body.days || 30);
  const ownerHash = extractOwnerKeyHash(order.reference);
  const stamp = new Date().toISOString().slice(0, 10);
  const nextRef = encodeReferenceWithOwnerHash(order.reference, ownerHash, `+${days}d@${stamp}`);

  await patchRow("partnerPlacements", id, {
    reference: nextRef
  });

  return {
    ok: true,
    placement: id,
    requestedDays: days,
    requestedAt: stamp,
    message: `Extension request for +${days} days recorded. We'll review and apply it to your pin.`
  };
}

async function partnerPlace(req, body) {
  const validation = validPartner(body);
  if (!validation.shop) {
    return { ok: false, error: validation.error || "include the shop's details" };
  }
  const shop = validation.shop;
  const quote = await partnerQuote(body);
  const reference = String(body.reference || "").trim();
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  // One shop, one spot. A live pin already here means this one cannot publish,
  // whether it is the same shop reordering or a competitor stacking on top.
  const occupied = await pinAt({ lat: shop.lat, lng: shop.lng });
  if (occupied) {
    return {
      ok: false,
      error: "a shop is already on the map at this spot",
      occupiedBy: occupied.name
    };
  }

  const isFreeLaunch = true;
  const paid = isFreeLaunch || reference.length > 0;
  const effectiveRef = isFreeLaunch && !reference ? "free-launch" : reference;
  const manageKey = mintOwnerKey();
  const ownerHash = await hashOwnerKey(id, manageKey);
  const storedReference = encodeReferenceWithOwnerHash(effectiveRef, ownerHash);

  // A shop is referred exactly once, by the first person who brings it. A
  // later submission inherits the original referrer and never re-attributes.
  const claimed = String(body.referralCode || "").toLowerCase();
  let referredBy = await referralOwnerOf(shop);
  if (!referredBy && validReferralCode(claimed)) {
    const claim = await claimShopReferral(claimed, shop, id)
      .catch((error) => { log(`shop claim failed: ${error}`); return null; });
    referredBy = claim ? claim.code : "";
  }
  const amountMicro = isFreeLaunch ? 0 : Math.round(quote.usdPerDay * 1_000_000) * quote.days;

  await writeRow("partnerPlacements", id, {
    name: shop.name,
    offer: shop.offer,
    lat: shop.lat,
    lng: shop.lng,
    category: shop.category,
    contact: shop.contact,
    link: shop.link,
    days: quote.days,
    amountMicro,
    currency: quote.currency,
    localTotal: isFreeLaunch ? 0 : Number(quote.totalLocal) || 0,
    tier: quote.tier,
    country: quote.country || "",
    reference: storedReference,
    status: paid ? (isFreeLaunch ? "active" : "pending") : "awaiting-payment",
    referredBy,
    paidAt: paid ? nowIso() : "",
    at: nowIso()
  });

  if (paid) {
    const activeUntil = new Date(Date.now() + quote.days * DAY_MS).toISOString();
    try {
      await writeRow("partners", id, {
        name: shop.name,
        category: shop.category,
        lat: shop.lat,
        lng: shop.lng,
        offer: shop.offer,
        sponsorLabel: "Local shop",
        phone: shop.phone || "",
        email: shop.email || "",
        address: shop.address || "",
        link: shop.link || "",
        contact: shop.contact || "",
        activeUntil
      });
    } catch (error) {
      log(`paid pin failed: ${error}`);
      return { ok: false, error: "could not publish the pin", placement: id };
    }

    // Credit the referrer from the amount we actually recorded, never from
    // anything the client sent. The deterministic row id makes a retry safe.
    let referral = null;
    if (referredBy) {
      referral = await creditReferral(id, referredBy, amountMicro, "placement")
        .catch((error) => { log(`referral credit failed: ${error}`); return null; });
    }

    return {
      ok: true,
      placement: id,
      manageKey,
      status: isFreeLaunch ? "active" : "pending",
      live: true,
      activeUntil,
      ...quote,
      referral: referral ? { code: referral.code, earnedUsd: Number((referral.earnedMicro / 1_000_000).toFixed(4)) } : null,
      next: `Your pin is live until ${activeUntil}. Save your Pin ID and Owner Secret Key to manage offers and request extra days.`
    };
  }

  return {
    ok: true,
    placement: id,
    manageKey,
    status: "awaiting-payment",
    live: false,
    activeUntil: null,
    ...quote,
    next: "Save your Pin ID and Owner Secret Key to manage this placement."
  };
}

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

function manifest() {
  return {
    service: "hodos",
    summary: "Passive, crowdsourced road-hazard mapping. Free to use; the API is metered, pay per call.",
    ask: "Want me to set it up for you, and you can see your data securely?",
    setup: {
      consent: "Ask the user before enabling anything. Every permission is listed with what it allows.",
      permissions: [
        { name: "read:road-data", allows: "Read hazard and road-quality points for an area. No personal data." },
        { name: "spend:credits", allows: "Spend the account's prepaid API credit on metered calls." },
        { name: "report:errors", allows: "Send a private error report or fix suggestion. No free-form upload." }
      ],
      afterApproval: "Provision a key, then call actions. Show the user their remaining balance."
    },
    auth: {
      inBody: "apiKey",
      note: "Send the key as the apiKey field of the inner request object, over HTTPS. Never put it in a URL, a log or a commit.",
      provision: { action: "provision", cost: "free", note: "Issues a trial key; needs the user's approval first." },
      storage: "Keys are stored only as SHA-256 hashes. Send the key from a secret store, never in a URL."
    },
    pricing: {
      unit: "micro-USD per call (1,000,000 = $1)",
      trial: TRIAL_MICRO,
      actions: Object.fromEntries(
        Object.entries(PRICES).map(([action, micro]) => [action, { micro, price: micro / 1_000_000 }])
      ),
      settlement: "Prepaid credit. Payoneer, card or PayPal reference via action:topup; credit is applied after settlement.",
      rule: "Calls are refused, never invoiced later. If the balance is empty, ask the user to top up."
    },
    actions: ACTIONS,
    privacy: [
      "No accounts, no personal identifiers, no advertising IDs.",
      "Road observations are anonymous and quantised; journey routes stay on the phone.",
      "Keys are hashed; usage rows carry only a key prefix."
    ],
    worldwide: "Same pricing and latency everywhere. No regional locks.",
    partners: {
      what: "Local shop pins on the live map. Call action:partners with a bounding box to read them.",
      price: "80 micro-USD per call. A shop pays a daily placement fee set by its country, in its own currency.",
      dailyTiersUsd: Object.fromEntries(
        Object.entries(PARTNER_TIERS).map(([name, value]) => [name, value.usdPerDay])
      ),
      aiVisible: "A live pin is returned by action:partners and is also attached to action:hazards and action:roads results for the same area, so an assistant answering a local question can name and recommend the shop.",
      buy: "https://hodos.devilabs.dev/partners"
    },
    how_to_talk_to_the_user: {
      before_a_paid_call: "Say what the call costs and how much credit is left, then make it.",
      template: "This will cost about {priceUsd} of your {creditsUsd} remaining credit.",
      when_empty: "Do not retry a 402. Tell the user the balance is empty and offer action:topup.",
      free_actions: "manifest, credits, report and provision are free. Say so when it helps.",
      note: "Prices are per call and tiny by design. A full month of checking one corridor costs well under a coffee."
    },
    if_you_see_an_error: "Call action:report with the error, the action you were calling, your environment and, if you know it, the fix. It is free and it reaches the maintainers.",
    docs: {
      agents: "https://hodos.devilabs.dev/AGENTS.md",
      index: "https://hodos.devilabs.dev/llms.txt",
      site: "https://hodos.devilabs.dev"
    },
    follow: "https://www.instagram.com/minerva__corporation/"
  };
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

module.exports = async function main(context) {
  const { req, res } = context;
  if (String(req.method || "POST").toUpperCase() === "OPTIONS") {
    return res.send("", 204, CORS);
  }

  const body = parseBody(req.body);
  const action = String(body.action || new URLSearchParams(req.query || "").get("action") || "manifest");
  const apiKey = apiKeyFrom(req, body);

  if (!ENDPOINT || !PROJECT || !KEY) {
    return res.json({ ok: false, error: "backend not configured", report: null }, 503, CORS);
  }

  if (!(action in ACTIONS)) {
    return res.json({
      ok: false,
      error: "unknown action",
      actions: Object.keys(ACTIONS)
    }, 400, CORS);
  }

  if (action === "manifest") {
    return res.json({ ok: true, manifest: manifest() }, 200, CORS);
  }


  // Free, keyless, and safe for a public page to call: pricing for a shop pin.
  if (action === "partnerQuote") {
    try {
      return res.json({ ok: true, ...(await partnerQuote(body)) }, 200, CORS);
    } catch (error) {
      log(`partnerQuote: ${error}`);
      return res.json({ ok: false, error: "quote unavailable" }, 502, CORS);
    }
  }

  if (action === "partnerExtend") {
    try {
      const result = await partnerExtend(req, body);
      return res.json(result, result.ok ? 200 : 400, CORS);
    } catch (error) {
      log(`partnerExtend: ${error}`);
      return res.json({ ok: false, error: "could not extend" }, 502, CORS);
    }
  }

  if (action === "partnerPlace") {
    try {
      const result = await partnerPlace(req, body);
      return res.json(result, result.ok ? 202 : 400, CORS);
    } catch (error) {
      log(`partnerPlace: ${error}`);
      return res.json({ ok: false, error: "could not record placement" }, 502, CORS);
    }
  }

  if (action === "partnerStatus") {
    try {
      const result = await partnerStatus(body);
      return res.json(result, result.ok ? 200 : 404, CORS);
    } catch (error) {
      log(`partnerStatus: ${error}`);
      return res.json({ ok: false, error: "could not read placement" }, 502, CORS);
    }
  }

  if (action === "partnerPortal" || action === "partnerUpdate" || action === "partnerRequestDays") {
    try {
      const result = action === "partnerPortal"
        ? await partnerPortal(body)
        : action === "partnerUpdate"
        ? await partnerUpdate(body)
        : await partnerRequestDays(body);
      const code = result.ok ? 200 : (result.status || 400);
      return res.json(result, code, CORS);
    } catch (error) {
      log(`${action}: ${error}`);
      return res.json({ ok: false, error: "shop portal is temporarily unavailable" }, 502, CORS);
    }
  }

  // Referrals: free, Nepal-only, and every amount is computed server-side.
  if (action === "referralCreate" || action === "referralProfile" || action === "referralRequestPayout") {
    try {
      const result = action === "referralCreate" ? await referralCreate(body)
        : action === "referralProfile" ? await referralProfile(body)
        : await referralRequestPayout(body);
      return res.json(result, result.ok ? 200 : 400, CORS);
    } catch (error) {
      log(`${action}: ${error}`);
      return res.json({ ok: false, error: "referrals are unavailable right now" }, 502, CORS);
    }
  }

  let account = null;
  try {
    if (action === "provision") {
      const bucket = await ipBucket(req, body);
      const recent = await readRows("apiKeys", [
        { method: "equal", attribute: "ipBucket", values: [bucket] },
        { method: "limit", values: [50] }
      ]);
      const hourAgo = Date.now() - 3600 * 1000;
      const fresh = recent.filter((row) => Date.parse(row.createdAt || 0) > hourAgo);
      if (fresh.length >= MAX_KEYS_PER_IP_HOUR) {
        return res.json({ ok: false, error: "too many keys from this address; try later" }, 429, CORS);
      }
      const raw = `hk_${[...crypto.getRandomValues(new Uint8Array(24))]
        .map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      const id = await keyId(raw);
      await writeRow("apiKeys", id, {
        label: String(body.label || "agent").slice(0, 60),
        profile: String(body.profile || "default").slice(0, 40),
        creditsMicro: TRIAL_MICRO,
        disabled: false,
        createdAt: nowIso(),
        ipBucket: bucket
      });
      return res.json({
        ok: true,
        key: raw,
        creditsMicro: TRIAL_MICRO,
        note: "Store this key in a secret. It is not shown again. Top up before the balance runs out."
      }, 200, CORS);
    }

    if (action === "topup") {
      const bucket = await ipBucket(req, body);
      const reference = String(body.reference || "").trim();
      if (reference.length < 4 || reference.length > 120) {
        return res.json({ ok: false, error: "include a payment reference" }, 400, CORS);
      }
      account = await startKey(apiKey);
      if (account.error) {
        return res.json({ ok: false, error: account.error }, 401, CORS);
      }
      const amountMicro = Math.min(Math.max(Number(body.amountMicro) || 0, 0), 100_000_000);
      if (amountMicro <= 0) {
        return res.json({ ok: false, error: "amountMicro must be positive" }, 400, CORS);
      }
      await writeRow("topupClaims", `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, {
        keyPrefix: account.prefix,
        reference,
        method: String(body.method || "payoneer").slice(0, 24),
        amountMicro,
        status: "pending",
        at: nowIso(),
        ipBucket: bucket
      });
      return res.json({
        ok: true,
        status: "pending",
        amountMicro,
        note: "Credit is applied once the payment clears. Payoneer, card and PayPal references all work."
      }, 202, CORS);
    }

    // Everything below is metered and needs a valid key.
    account = await startKey(apiKey);
    if (account.error) {
      return res.json({
        ok: false,
        error: account.error,
        hint: "provision a key with the user's approval, or read the manifest for pricing"
      }, 401, CORS);
    }

    if (action === "report") {
      const id = await fileReport({
        ...body,
        keyPrefix: account.prefix
      });
      return res.json({ ok: true, report: id }, 200, CORS);
    }

    if (action === "credits") {
      const usage = await readRows("apiUsage", [
        { method: "equal", attribute: "keyPrefix", values: [account.prefix] },
        { method: "limit", values: [20] }
      ]);
      return res.json({
        ok: true,
        creditsMicro: Number(account.row.creditsMicro) || 0,
        priceTable: PRICES,
        recent: usage.map((row) => ({
          action: row.action,
          costMicro: row.costMicro,
          at: row.at
        }))
      }, 200, CORS);
    }

    const payment = await charge(account, action);
    if (payment.insufficient) {
      return res.json({
        ok: false,
        error: "insufficient credit",
        costMicro: payment.cost,
        creditsMicro: payment.remaining,
        hint: "ask the user to top up, or use action:topup with a payment reference"
      }, 402, CORS);
    }

    let result;
    if (action === "hazards") result = await hazards(body);
    else if (action === "roads") result = await roads(body);
    else if (action === "garage") result = await garage(body);
    else if (action === "partners") result = await partners(body);
    else if (action === "graph") result = await graph(body);
    else result = { ok: false };

    return res.json({
      ok: true,
      action,
      costMicro: payment.cost,
      creditsMicro: payment.remaining,
      result
    }, 200, CORS);
  } catch (error) {
    log(`${action}: ${error}`);
    let reportId = null;
    try {
      reportId = await fileReport({
        kind: "server-error",
        action,
        message: String(error),
        environment: "hodos-api",
        keyPrefix: account?.prefix || ""
      });
    } catch (_) {
      // Reporting must never mask the original failure.
    }
    return res.json({
      ok: false,
      error: "temporary failure",
      report: reportId,
      hint: "call action:report with your context so the maintainers can fix it"
    }, 502, CORS);
  }
};

module.exports.testing = {
  PRICES,
  ACTIONS,
  PARTNER_TIERS,
  partnerQuote,
  partnerStatus,
  partnerPortal,
  partnerUpdate,
  partnerRequestDays,
  mintOwnerKey,
  hashOwnerKey,
  encodeReferenceWithOwnerHash,
  extractOwnerKeyHash,
  extractExtensionRequest,
  verifyOwnerKey,
  durationFactor,
  countryFor,
  tierFor,
  clampDays,
  currencyFor,
  roundMoney,
  validPartner,
  manifest,
  parseBody,
  headersOf,
  REFERRAL_SHARE,
  REFERRAL_MIN_PAYOUT_MICRO,
  REFERRAL_TERRITORIES,
  REFERRAL_MATURITY_DAYS,
  REFERRAL_MATURITY_MS,
  PAYOUT_METHODS,
  isNepalCoordinate,
  normalizePayout,
  validReferralCode,
  makeReferralCode,
  referralGate,
  shapeReferral,
  creditReferral,
  shopKeyFor,
  claimShopReferral,
  referralOwnerOf,
  pinAt,
  metresBetween,
  PIN_MIN_SEPARATION_M,
  validBbox,
  shapeHazard,
  keyId
};

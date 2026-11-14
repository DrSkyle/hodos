/**
 * Hodos Garage — affiliate offers and the road-notes list.
 *
 * The Garage is how Hodos earns without putting ads on the map. Products come
 * from Channel3; every `ProductOffer.url` Channel3 returns is already an
 * affiliate link tracked to this project's key, so both the website and the
 * app link straight through and a completed purchase earns a commission.
 *
 * The Channel3 key stays here. Clients POST { action } to this function and
 * receive a small, stable shape, so nothing secret ships in a web bundle or an
 * APK. Offers are cached in memory for ten minutes: the catalogue is large and
 * affiliate URLs must not be stored long-term.
 */

const SEARCH_URL = "https://api.trychannel3.com/v1/search";
const CACHE_TTL_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 8;

const ENDPOINT = process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;
const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";
const CHANNEL3_KEY = process.env.CHANNEL3_API_KEY;

/**
 * The only queries this function will run. A client can pick a slot, never
 * supply a query, so the key cannot be used to search the whole catalogue.
 */
const SLOTS = {
  inflator: { label: "Tire inflator", query: "portable tire inflator air compressor", maxPrice: 120 },
  mount: { label: "Phone mount", query: "car phone mount", maxPrice: 60 },
  dashcam: { label: "Dash cam", query: "dash cam for car", maxPrice: 260 },
  pressure: { label: "Pressure gauge", query: "digital tire pressure gauge", maxPrice: 40 },
  care: { label: "Wash kit", query: "car wash kit microfiber towels", maxPrice: 80 },
  wipers: { label: "Wipers", query: "windshield wiper blades", maxPrice: 60 },
  tires: { label: "Tires", query: "all season car tires", maxPrice: 320 },
  light: { label: "Lights", query: "car headlight bulbs", maxPrice: 90 }
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Appwrite-Project",
  "Cache-Control": "public, max-age=300"
};

const cache = new Map();

function log(message) {
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log(message);
  }
}

function slotNames() {
  return Object.keys(SLOTS);
}

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

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

function priceOf(offer) {
  const price = offer && offer.price && offer.price.price;
  return typeof price === "number" && Number.isFinite(price) ? price : null;
}

function currencyOf(offer) {
  return offer && offer.price && typeof offer.price.currency === "string"
    ? offer.price.currency
    : "USD";
}

/** In-stock, priced offer with the best commission; cheapest breaks ties. */
function bestOffer(product) {
  const offers = Array.isArray(product && product.offers) ? product.offers : [];
  const usable = offers.filter((offer) => {
    if (!offer || typeof offer.url !== "string") return false;
    if (!/^https:\/\//i.test(offer.url)) return false;
    if (offer.availability === "OutOfStock") return false;
    return priceOf(offer) !== null;
  });
  if (usable.length === 0) return null;
  return usable.sort((a, b) => {
    const commission = (b.max_commission_rate || 0) - (a.max_commission_rate || 0);
    if (Math.abs(commission) > 1e-9) return commission;
    return priceOf(a) - priceOf(b);
  })[0];
}

function firstImage(product) {
  const images = Array.isArray(product && product.images) ? product.images : [];
  const main = images.find((image) => image && image.is_main_image) || images[0];
  if (!main || typeof main.url !== "string") return null;
  return /^https:\/\//i.test(main.url) ? main.url : null;
}

function brandOf(product) {
  const brands = Array.isArray(product && product.brands) ? product.brands : [];
  const brand = brands[0];
  return brand && typeof brand.name === "string" ? brand.name : null;
}

/**
 * Trim a Channel3 product down to what a card needs. Long descriptions are
 * deliberately dropped: the app shows a title, a merchant and a price.
 */
function shapeProduct(product) {
  if (!product || typeof product.id !== "string" || typeof product.title !== "string") {
    return null;
  }
  const offer = bestOffer(product);
  if (!offer) return null;
  const title = product.title.trim().slice(0, 140);
  if (!title) return null;
  return {
    id: product.id,
    title,
    brand: brandOf(product),
    image: firstImage(product),
    price: priceOf(offer),
    compareAt: offer.price && typeof offer.price.compare_at_price === "number"
      ? offer.price.compare_at_price
      : null,
    currency: currencyOf(offer),
    merchant: typeof offer.domain === "string" ? offer.domain : null,
    url: offer.url
  };
}

function shapeProducts(products) {
  const seen = new Set();
  const shaped = [];
  for (const product of products) {
    const card = shapeProduct(product);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    shaped.push(card);
    if (shaped.length >= MAX_RESULTS) break;
  }
  return shaped;
}

async function fetchSlot(slot) {
  const definition = SLOTS[slot];
  const cached = cache.get(slot);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  if (!CHANNEL3_KEY) {
    return { ok: false, slot, error: "affiliate key not configured", products: [] };
  }

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "x-api-key": CHANNEL3_KEY,
      "Content-Type": "application/json",
      "User-Agent": "Hodos-Garage"
    },
    body: JSON.stringify({
      query: definition.query,
      limit: 20,
      filters: { price: { max_price: definition.maxPrice } },
      config: { country: "US", currency: "USD", language: "en", mode: "default" }
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  });

  if (!response.ok) {
    log(`channel3 ${response.status} for ${slot}`);
    return { ok: false, slot, error: `catalogue ${response.status}`, products: [] };
  }

  const body = await response.json();
  const payload = {
    ok: true,
    slot,
    label: definition.label,
    products: shapeProducts(Array.isArray(body.products) ? body.products : []),
    fetchedAt: new Date().toISOString()
  };
  if (payload.products.length > 0) {
    cache.set(slot, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return payload;
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

  if (method === "OPTIONS") {
    return res.send("", 204, CORS);
  }

  const action = body.action || (body.slot ? "offers" : null);

  if (action === "subscribe") {
    try {
      const result = await subscribe(body.email, body.source);
      return res.json(result, result.ok ? 200 : 400, CORS);
    } catch (error) {
      log(`subscribe failed: ${error}`);
      return res.json({ ok: false, error: "could not save" }, 502, CORS);
    }
  }

  if (action === "offers" || !action) {
    const slot = typeof body.slot === "string" ? body.slot : "inflator";
    if (!SLOTS[slot]) {
      return res.json({ ok: false, error: "unknown slot", slots: slotNames() }, 400, CORS);
    }
    try {
      const payload = await fetchSlot(slot);
      return res.json(payload, payload.ok ? 200 : 502, CORS);
    } catch (error) {
      log(`offers failed: ${error}`);
      return res.json({ ok: false, slot, error: "catalogue unavailable", products: [] }, 502, CORS);
    }
  }

  return res.json({ ok: false, error: "unknown action", slots: slotNames() }, 400, CORS);
};

module.exports.testing = {
  SLOTS,
  slotNames,
  validEmail,
  normaliseEmail,
  bestOffer,
  shapeProduct,
  shapeProducts,
  parseBody
};

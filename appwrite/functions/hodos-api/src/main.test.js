const test = require("node:test");
const assert = require("node:assert/strict");
// Tests never touch the live backend.
process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
process.env.APPWRITE_FUNCTION_API_KEY = "test-key-not-secret";

const api = require("./main.js");
const { testing } = api;

test("manifest is free, self-describing and asks the user first", () => {
  const manifest = testing.manifest();
  assert.equal(manifest.service, "hodos");
  assert.match(manifest.ask, /set it up for you/i);
  assert.equal(manifest.pricing.actions.manifest.micro, 0);
  assert.ok(manifest.actions.hazards);
  assert.ok(manifest.setup.permissions.length >= 3);
  assert.ok(manifest.if_you_see_an_error.includes("action:report"));
});

test("every priced action has a non-negative integer price", () => {
  for (const [action, micro] of Object.entries(testing.PRICES)) {
    assert.ok(Number.isInteger(micro), `${action} price must be an integer`);
    assert.ok(micro >= 0, `${action} price must not be negative`);
  }
});

test("expensive graph reads cost more than plain hazards", () => {
  assert.ok(testing.PRICES.graph > testing.PRICES.hazards);
  assert.equal(testing.PRICES.report, 0);
});

test("bounding boxes are validated, never trusted", () => {
  assert.deepEqual(testing.validBbox({ west: -1, south: -1, east: 1, north: 1 }),
    { west: -1, south: -1, east: 1, north: 1 });
  for (const value of [
    null,
    {},
    { west: 2, south: -1, east: 1, north: 1 },
    { west: -1, south: 2, east: 1, north: 1 },
    { west: -181, south: -1, east: 1, north: 1 },
    { west: -1, south: -1, east: 181, north: 1 },
    { west: "a", south: -1, east: 1, north: 1 }
  ]) {
    assert.equal(testing.validBbox(value), null);
  }
});

test("hazard shaping drops rows without usable coordinates", () => {
  assert.equal(testing.shapeHazard({ $id: "a", lat: "x", lng: 1 }), null);
  assert.equal(testing.shapeHazard({ $id: "a", lat: 1 }), null);
  const shaped = testing.shapeHazard({
    $id: "h1",
    kind: "rough_pavement",
    severity: "2",
    lat: 27.7,
    lng: 85.3,
    passes: 4,
    fixed: false,
    $updatedAt: "2026-11-01T00:00:00Z"
  });
  assert.deepEqual(shaped, {
    id: "h1",
    kind: "rough_pavement",
    severity: 2,
    lat: 27.7,
    lng: 85.3,
    passes: 4,
    fixed: false,
    lastSeen: "2026-11-01T00:00:00Z"
  });
});

test("header lookup is case-insensitive so agents can send any casing", () => {
  const headers = testing.headersOf({ req: { headers: { "X-Hodos-Key": "hk_abc" } } });
  assert.equal(headers["x-hodos-key"], undefined);
  const real = testing.headersOf({ headers: { "X-Hodos-Key": "hk_abc" } });
  assert.equal(real["x-hodos-key"], "hk_abc");
});

test("keys are addressed by a truncated hash, never stored raw", async () => {
  const id = await testing.keyId("hk_" + "a".repeat(48));
  assert.equal(id.length, 32);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.notEqual(id, "hk_" + "a".repeat(48));
  const again = await testing.keyId("hk_" + "a".repeat(48));
  assert.equal(id, again);
});

test("unparseable bodies become an empty request", () => {
  assert.deepEqual(testing.parseBody("nope"), {});
  assert.deepEqual(testing.parseBody(""), {});
  assert.deepEqual(testing.parseBody('{"action":"hazards"}'), { action: "hazards" });
});

test("placement days are clamped to a sane range", () => {
  assert.equal(testing.clampDays(9), 9);
  assert.equal(testing.clampDays(0), 1);
  assert.equal(testing.clampDays(-4), 1);
  assert.equal(testing.clampDays(9999), 90);
  assert.equal(testing.clampDays("7"), 7);
});

test("currency is resolved from a locale tag, never from the network", () => {
  assert.equal(testing.currencyFor("ne-NP"), "NPR");
  assert.equal(testing.currencyFor("en-IN"), "INR");
  assert.equal(testing.currencyFor("ur_PK"), "PKR");
  assert.equal(testing.currencyFor("en-GB"), "GBP");
  assert.equal(testing.currencyFor("ja-JP"), "JPY");
  assert.equal(testing.currencyFor("en-US"), "USD");
  assert.equal(testing.currencyFor("xx-YY"), "USD");
  assert.equal(testing.currencyFor("en-NP", "usd"), "USD");
});

test("the daily price stays one flat USD wherever it is sold", () => {
  assert.equal(testing.PARTNER_USD_PER_DAY, 0.99);
  assert.equal(testing.PARTNER_MICRO_PER_DAY, 990000);
});

test("zero-decimal currencies are not given cents", () => {
  assert.equal(testing.roundMoney(133.6, "JPY"), 134);
  assert.equal(testing.roundMoney(133.6, "NPR"), 133.6);
  assert.equal(testing.roundMoney(0.1234, "USD"), 0.123);
});

test("a placement needs a name, a line and a real point", () => {
  assert.equal(testing.validPartner({ name: "A", offer: "x", lat: 1, lng: 1 }), null);
  assert.equal(testing.validPartner({ name: "Shop", offer: "", lat: 1, lng: 1 }), null);
  assert.equal(testing.validPartner({ name: "Shop", offer: "Fix", lat: 91, lng: 1 }), null);
  assert.equal(testing.validPartner({ name: "Shop", offer: "Fix", lat: 1, lng: 181 }), null);
  const ok = testing.validPartner({ name: "Shop", offer: "Puncture repair", lat: 27.7, lng: 85.3 });
  assert.equal(ok.name, "Shop");
  assert.equal(ok.lat, 27.7);
});

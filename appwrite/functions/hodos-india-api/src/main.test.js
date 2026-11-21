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
  // A shop can buy as long as a year at once, and never more.
  assert.equal(testing.clampDays(365), 365);
  assert.equal(testing.clampDays(9999), 365);
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

test("placement pricing follows the local economy, not one global number", () => {
  const { high, mid, low } = testing.PARTNER_TIERS;
  assert.ok(low.usdPerDay < mid.usdPerDay, "low tier must be cheaper than mid");
  assert.ok(mid.usdPerDay < high.usdPerDay, "mid tier must be cheaper than standard");
  assert.equal(low.usdPerDay, 0.19);
  assert.equal(high.usdPerDay, 1.99);
});

test("country tiers resolve from a locale tag only", () => {
  assert.equal(testing.countryFor("ne-NP"), "NP");
  assert.equal(testing.countryFor("en-IN"), "IN");
  assert.equal(testing.countryFor("en_US"), "US");
  assert.equal(testing.countryFor("", "lk"), "LK");
  assert.equal(testing.countryFor("en-GB", "fr"), "FR");
  assert.equal(testing.countryFor(""), "");
});

test("cheap markets are sold at the access tier, rich ones at standard", () => {
  for (const code of ["NP", "IN", "PK", "BD", "NG", "KE", "VN", "PH", "ET"]) {
    assert.equal(testing.tierFor(code), "low", `${code} should be low tier`);
  }
  for (const code of ["US", "GB", "DE", "JP", "AU", "CA"]) {
    assert.equal(testing.tierFor(code), "high", `${code} should be high tier`);
  }
  assert.equal(testing.tierFor("MX"), "mid");
  assert.equal(testing.tierFor("ZZ"), "high", "unknown countries default to standard");
});

test("zero-decimal currencies are not given cents", () => {
  assert.equal(testing.roundMoney(133.6, "JPY"), 134);
  assert.equal(testing.roundMoney(133.6, "NPR"), 133.6);
  assert.equal(testing.roundMoney(0.1234, "USD"), 0.123);
});

test("a placement needs a real shop, a real point and a reachable contact", () => {
  const base = {
    name: "Bhatbhateni Tyre House",
    offer: "Puncture repair and tyre fitting",
    address: "Kalanki, Ring Road, Kathmandu",
    phone: "9801234567",
    lat: 27.7,
    lng: 85.3
  };

  // Refused: placeholder name, empty line, missing address, no contact, bad coords.
  assert.ok(testing.validPartner({ ...base, name: "A" }).error);
  assert.ok(testing.validPartner({ ...base, name: "123" }).error);
  assert.ok(testing.validPartner({ ...base, offer: "" }).error);
  assert.ok(testing.validPartner({ ...base, offer: "Fix" }).error);
  assert.ok(testing.validPartner({ ...base, address: "" }).error);
  assert.ok(testing.validPartner({ ...base, phone: "", email: "" }).error);
  assert.ok(testing.validPartner({ ...base, phone: "abc" }).error);
  assert.ok(testing.validPartner({ ...base, lat: 91 }).error);
  assert.ok(testing.validPartner({ ...base, lat: 0, lng: 0 }).error);
  assert.ok(testing.validPartner({ ...base, link: "not-a-url" }).error);

  // Accepted: a shop with a name, a real line, an address and a phone.
  const ok = testing.validPartner(base).shop;
  assert.equal(ok.name, "Bhatbhateni Tyre House");
  assert.equal(ok.lat, 27.7);
  assert.equal(ok.phone, "9801234567");
  assert.equal(ok.contact, "tel:9801234567");

  // A phone number is mandatory for every placement, trial included: a pin
  // nobody can call is not a shop. An email is a bonus, not a substitute.
  assert.ok(testing.validPartner({ ...base, phone: "", email: "shop@example.com" }).error);
  const withEmail = testing.validPartner({ ...base, email: "shop@example.com" }).shop;
  assert.equal(withEmail.email, "shop@example.com");
  assert.equal(withEmail.phone, "9801234567");
  assert.equal(withEmail.contact, "tel:9801234567");

  // Nepali shop names are welcome.
  assert.ok(testing.validPartner({ ...base, name: "सागर टायर पसल" }).shop);
});


/* ---- Referrals: India-only earnings, tamper-resistant ---- */

test("referral split is 60/40 and never paid out below the minimum", () => {
  assert.equal(testing.REFERRAL_SHARE, 0.6);
  assert.equal(testing.REFERRAL_MIN_PAYOUT_MICRO, 100000);
  assert.deepEqual(testing.REFERRAL_TERRITORIES, ["IN"]);
});

test("only India coordinates pass the territory gate", () => {
  // Delhi, Mumbai, Bengaluru, Chennai, Kolkata, Guwahati.
  assert.equal(testing.isIndiaCoordinate(28.6139, 77.209), true);
  assert.equal(testing.isIndiaCoordinate(19.076, 72.8777), true);
  assert.equal(testing.isIndiaCoordinate(12.9716, 77.5946), true);
  assert.equal(testing.isIndiaCoordinate(13.0827, 80.2707), true);
  assert.equal(testing.isIndiaCoordinate(22.5726, 88.3639), true);
  assert.equal(testing.isIndiaCoordinate(26.1445, 91.7362), true);
  // Kathmandu, Dhaka, Colombo, Thimphu, and a junk value.
  assert.equal(testing.isIndiaCoordinate(27.7172, 85.324), false);
  assert.equal(testing.isIndiaCoordinate(23.8103, 90.4125), false);
  assert.equal(testing.isIndiaCoordinate(6.9271, 79.8612), false);
  assert.equal(testing.isIndiaCoordinate(27.4728, 89.6393), false);
  assert.equal(testing.isIndiaCoordinate(NaN, 77), false);
});

test("a claim needs India coordinates AND an Indian UPI or IMPS payout account", () => {
  const delhi = { lat: 28.6139, lng: 77.209 };
  const upi = { payoutMethod: "upi", payoutAccount: "aarav@okicici" };
  const imps = { payoutMethod: "imps", payoutAccount: "123456789012 / HDFC0001234" };

  assert.equal(testing.referralGate({ ...delhi, ...upi }).ok, true);
  assert.equal(testing.referralGate({ ...delhi, ...imps, ownerName: "Aarav" }).ok, true);

  // Location alone is not enough.
  assert.equal(testing.referralGate(delhi).ok, false);
  // A UPI ID but outside India (Kathmandu).
  assert.equal(testing.referralGate({ lat: 27.7172, lng: 85.324, ...upi }).ok, false);
  // An unsupported payout rail.
  assert.equal(testing.referralGate({ ...delhi, payoutMethod: "paypal", payoutAccount: "x@y.com" }).ok, false);
  // Invalid UPI ID (missing @handle).
  assert.equal(testing.referralGate({ ...delhi, payoutMethod: "upi", payoutAccount: "9876543210" }).ok, false);
  // An IMPS account too short to be real.
  assert.equal(testing.referralGate({ ...delhi, payoutMethod: "imps", payoutAccount: "123" }).ok, false);
});

test("payout methods are Indian UPI and IMPS/Bank", () => {
  assert.deepEqual(Object.keys(testing.PAYOUT_METHODS).sort(), ["imps", "upi"]);
  for (const rule of Object.values(testing.PAYOUT_METHODS)) {
    assert.equal(rule.country, "IN");
  }
});

test("referral codes are lowercase, unguessable and stable in shape", () => {
  const code = testing.makeReferralCode("Aarav Sharma");
  assert.match(code, /^[a-z0-9]{6,24}$/);
  assert.notEqual(testing.makeReferralCode("Aarav Sharma"), testing.makeReferralCode("Aarav Sharma"));
  assert.equal(testing.validReferralCode("abcd1234"), true);
  assert.equal(testing.validReferralCode("ABCD"), false);
  assert.equal(testing.validReferralCode("ab"), false);
});

test("a referral profile masks the payout account and reports balance", () => {
  const shaped = testing.shapeReferral(
    { code: "aaraabcd123", ownerName: "Aarav", payoutMethod: "upi",
      payoutAccount: "aarav@okicici", country: "IN", disabled: false },
    { earnedMicro: 2400000, paidMicro: 1000000, owedMicro: 1400000, placements: 2 }
  );
  assert.equal(shaped.share, 0.6);
  assert.equal(shaped.payoutAccount, "•••••••••cici");
  assert.equal(shaped.owedUsd, 1.4);
  assert.equal(shaped.available, true);
  assert.equal(shaped.referrals, 2);
});

test("below the minimum balance is not payable", () => {
  const shaped = testing.shapeReferral(
    { code: "aaraabcd123", ownerName: "Aarav", payoutMethod: "upi",
      payoutAccount: "aarav@okicici", country: "IN", disabled: false },
    { earnedMicro: 50000, paidMicro: 0, owedMicro: 50000, placements: 1 }
  );
  assert.equal(shaped.available, false);
});

test("referral commissions show immediately in earned/owed balance and mature after 30 days", () => {
  assert.equal(testing.REFERRAL_MATURITY_DAYS, 30);
  const unmatured = testing.shapeReferral(
    { code: "sitaabcd123", ownerName: "Sita", payoutMethod: "esewa",
      payoutAccount: "9801234567", country: "NP", disabled: false },
    {
      earnedMicro: 1500000,
      paidMicro: 0,
      owedMicro: 1500000,
      maturedMicro: 0,
      pendingMicro: 1500000,
      nextCashoutAt: "2026-12-16T00:00:00.000Z",
      placements: 1
    }
  );
  assert.equal(unmatured.earnedUsd, 1.5);
  assert.equal(unmatured.owedUsd, 1.5);
  assert.equal(unmatured.pendingUsd, 1.5);
  assert.equal(unmatured.maturedUsd, 0);
  assert.equal(unmatured.available, false);
  assert.equal(unmatured.nextCashoutAt, "2026-12-16T00:00:00.000Z");
});

test("Nepali shops are offered rails they actually have", async () => {
  // The quote is async (it reads FX rates), so this exercises the real shape.
  // A Nepali shop should never be asked for a Payoneer account.
  const np = await testing.partnerQuote({ countryCode: "NP", days: 3 });
  assert.equal(np.country, "NP");
  assert.match(np.settlement, /eSewa|Khalti|bank/i);
  assert.ok(np.settlementOptions.includes("esewa"));

  const de = await testing.partnerQuote({ countryCode: "DE", days: 3 });
  assert.equal(de.country, "DE");
  assert.match(de.settlement, /Payoneer|card|PayPal/i);
  assert.ok(!de.settlementOptions.includes("esewa"));
});

test("longer placement durations reduce the daily rate progressively (1 > 3 > 7 > 14 > 30 > 90 > 180 > 365)", async () => {
  const steps = [1, 3, 7, 14, 30, 90, 180, 365];
  const quotes = [];
  for (const days of steps) {
    quotes.push(await testing.partnerQuote({ countryCode: "NP", currency: "NPR", days }));
  }
  for (let i = 1; i < quotes.length; i += 1) {
    assert.ok(
      quotes[i].localPerDay < quotes[i - 1].localPerDay,
      `expected ${steps[i]}d daily rate (${quotes[i].localPerDay}) < ${steps[i - 1]}d (${quotes[i - 1].localPerDay})`
    );
  }
  assert.equal(quotes[0].discountPct, 0);
  assert.equal(quotes[quotes.length - 1].discountPct, 40);
});

test("partnerStatus rejects malformed placement ids before hitting storage", async () => {
  const bad = await testing.partnerStatus({ placement: "not-an-id" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "unknown placement");
});

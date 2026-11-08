const test = require("node:test");
const assert = require("node:assert/strict");
process.env.HODOS_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.HODOS_PROJECT_ID = "test-project";
process.env.HODOS_API_KEY = "test-key-not-secret";

const ingest = require("./main.js");
const { testing } = ingest;

function mine(partnerId, passToken) {
  for (let nonce = 0; nonce < 2_000_000; nonce += 1) {
    if (testing.proofOk(partnerId, passToken, String(nonce))) return String(nonce);
  }
  throw new Error("could not mine test proof");
}

test("proof of work is bound to shop and token", () => {
  const partnerId = "shop-a";
  const token = "0123456789abcdef";
  const nonce = mine(partnerId, token);
  assert.equal(testing.proofOk(partnerId, token, nonce), true);
  assert.equal(testing.proofOk("shop-b", token, nonce), false);
  assert.equal(testing.proofOk(partnerId, "fedcba9876543210", nonce), false);
  assert.equal(testing.proofOk(partnerId, token, String(Number(nonce) + 1)), false);
});

test("input validation rejects junk and spoofable formats", () => {
  assert.equal(testing.validPartnerId("shop-a_1"), true);
  for (const value of ["", "shop a", "shop/a", "x".repeat(65), null, 12]) {
    assert.equal(testing.validPartnerId(value), false);
  }
  assert.equal(testing.validToken("0123456789abcdef"), true);
  for (const value of ["0123", "ZZZZZZZZZZZZZZZZ", "", null]) {
    assert.equal(testing.validToken(value), false);
  }
  assert.equal(testing.validNonce("12345"), true);
  for (const value of ["", "-1", "1.5", "abc", null]) {
    assert.equal(testing.validNonce(value), false);
  }
});

test("row id is deterministic and fits Appwrite's limit", () => {
  const first = testing.rowIdFor("shop-a", "0123456789abcdef");
  assert.equal(first, testing.rowIdFor("shop-a", "0123456789abcdef"));
  assert.notEqual(first, testing.rowIdFor("shop-b", "0123456789abcdef"));
  assert.ok(first.length <= 36);
});

test("server derives month, day and hour in UTC", () => {
  const parts = testing.utcParts(Date.parse("2026-07-31T23:59:59Z"));
  assert.equal(parts.month, "2026-07");
  assert.equal(parts.day, "2026-07-31");
  assert.equal(parts.hour, "2026-07-31T23");
});

test("body parsing accepts raw and wrapped payloads", () => {
  assert.deepEqual(testing.parseBody('{"partnerId":"a"}'), { partnerId: "a" });
  assert.deepEqual(testing.parseBody('{"data":{"partnerId":"a"}}'), { partnerId: "a" });
  assert.deepEqual(testing.parseBody({ partnerId: "a" }), { partnerId: "a" });
  assert.deepEqual(testing.parseBody("nonsense"), {});
});

test("reads the payload from whichever request field Appwrite populates", () => {
  assert.deepEqual(
    testing.extractPayload({ bodyText: '{"partnerId":"a"}' }),
    { partnerId: "a" }
  );
  assert.deepEqual(
    testing.extractPayload({ bodyRaw: '{"data":{"partnerId":"b"}}' }),
    { partnerId: "b" }
  );
  assert.deepEqual(
    testing.extractPayload({ bodyJson: { partnerId: "c" } }),
    { partnerId: "c" }
  );
  assert.deepEqual(testing.extractPayload({ body: "" }), {});
});

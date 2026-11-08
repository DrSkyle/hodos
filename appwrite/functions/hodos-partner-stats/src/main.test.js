const test = require("node:test");
const assert = require("node:assert/strict");
// Tests must never use live credentials or external network access.
process.env.HODOS_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.HODOS_PROJECT_ID = "test-project";
process.env.HODOS_API_KEY = "test-key-not-secret";

const partnerStats = require("./main.js");
const { testing } = partnerStats;

test("accepts only canonical month keys", () => {
  assert.equal(testing.validMonth("2026-11"), true);
  for (const value of ["2026-13", "2026-1", "26-11", "", null, "2026-00", "2026-11-01"]) {
    assert.equal(testing.validMonth(value), false);
  }
});

test("rejects malformed pass rows and rows from another month", () => {
  const row = { partnerId: "shop-a", passToken: "abcdef1234567890", month: "2026-11" };
  assert.equal(testing.validRow(row, "2026-11"), true);
  assert.equal(testing.validRow(row, "2026-10"), false);
  assert.equal(testing.validRow({ ...row, passToken: "short" }, "2026-11"), false);
  assert.equal(testing.validRow({ ...row, partnerId: "" }, "2026-11"), false);
});

test("deduplicates blinded tokens per partner", () => {
  const counts = testing.countByPartner(
    [
      { partnerId: "shop-a", passToken: "token-one-0001", month: "2026-11" },
      { partnerId: "shop-a", passToken: "token-one-0001", month: "2026-11" },
      { partnerId: "shop-a", passToken: "token-two-0002", month: "2026-11" },
      { partnerId: "shop-b", passToken: "token-one-0001", month: "2026-11" },
      { partnerId: "shop-b", passToken: "bad-month-000", month: "2026-10" }
    ],
    "2026-11"
  );
  assert.equal(counts.get("shop-a"), 2);
  assert.equal(counts.get("shop-b"), 1);
  assert.equal(counts.size, 2);
});

test("stat row ids are deterministic and fit Appwrite's limit", () => {
  const first = testing.statRowId("shop-a", "2026-11");
  const second = testing.statRowId("shop-a", "2026-11");
  assert.equal(first, second);
  assert.ok(first.length <= 36);
  assert.notEqual(first, testing.statRowId("shop-a", "2026-12"));
});

test("current month is UTC and zero padded", () => {
  assert.equal(testing.currentMonth(Date.parse("2026-01-31T23:59:59Z")), "2026-01");
  assert.equal(testing.currentMonth(Date.parse("2026-11-08T00:00:00Z")), "2026-11");
});

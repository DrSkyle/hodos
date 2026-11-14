const test = require("node:test");
const assert = require("node:assert/strict");
// Tests never touch the live backend.
process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
process.env.APPWRITE_FUNCTION_API_KEY = "test-key-not-secret";

const affiliate = require("./main.js");
const { testing } = affiliate;

test("accepts plausible addresses and rejects malformed ones", () => {
  assert.equal(testing.validEmail("driver@example.com"), true);
  assert.equal(testing.validEmail("  Driver@Example.COM "), true);
  for (const value of ["", "no-at", "a@b", "a@b.c", "@example.com", null, 42]) {
    assert.equal(testing.validEmail(value), false);
  }
});

test("normalises addresses before they are stored", () => {
  assert.equal(testing.normaliseEmail("  Driver@Example.COM "), "driver@example.com");
});

test("unparseable bodies become an empty request", () => {
  assert.deepEqual(testing.parseBody("nope"), {});
  assert.deepEqual(testing.parseBody(""), {});
  assert.deepEqual(testing.parseBody('{"email":"a@b.co"}'), { email: "a@b.co" });
});

test("only the newsletter action exists now that the catalogue is gone", async () => {
  const res = await affiliate({
    req: { method: "POST", body: JSON.stringify({ action: "offers" }) },
    res: { json: (body, status) => ({ body, status }) }
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.actions, ["subscribe"]);
});

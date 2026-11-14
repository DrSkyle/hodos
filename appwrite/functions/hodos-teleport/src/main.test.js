const test = require("node:test");
const assert = require("node:assert/strict");
// Tests never touch the live backend or Admitad.
process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
process.env.APPWRITE_FUNCTION_API_KEY = "test-key-not-secret";

const teleport = require("./main.js");
const { testing } = teleport;

test("only Admitad tracking hosts are accepted", () => {
  assert.equal(testing.isAdmitadHost("ad.admitad.com"), true);
  assert.equal(testing.isAdmitadHost("some.admitad.com"), true);
  assert.equal(testing.isAdmitadHost("admitad.com"), true);
  assert.equal(testing.isAdmitadHost("admitad.com.evil.example"), false);
  assert.equal(testing.isAdmitadHost("notadmitad.com"), false);
  assert.equal(testing.isAdmitadHost("localhost"), false);
});

test("a /g/ affiliate link becomes a /tptv2/ Teleport link", () => {
  const result = testing.toTeleportUrl("https://ad.admitad.com/g/1e8d114494b7e165239416525dc3e8/");
  assert.equal(result.hash, "1e8d114494b7e165239416525dc3e8");
  assert.equal(result.url.toString(), "https://ad.admitad.com/tptv2/1e8d114494b7e165239416525dc3e8/");
});

test("a link that is not an affiliate redirect is refused", () => {
  assert.equal(testing.toTeleportUrl("https://ad.admitad.com/").error, "expected an Admitad affiliate link with a /g/<id>/ path");
  assert.equal(testing.toTeleportUrl("https://short.example/g/abcdefghijkl/").error, "not an Admitad link");
  assert.equal(testing.toTeleportUrl("http://ad.admitad.com/g/abcdefghijkl/").error, "https only");
  assert.equal(testing.toTeleportUrl("not a url").error, "not a valid URL");
  assert.equal(testing.toTeleportUrl("https://ad.admitad.com/tptv2/abcdefghijkl/").error.startsWith("expected"), true);
});

test("the visitor IP comes from the platform before the caller", () => {
  assert.equal(testing.clientIp({ headers: { "x-appwrite-client-ip": "203.0.113.9" } }, { ip: "10.0.0.1" }), "203.0.113.9");
  assert.equal(testing.clientIp({ headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" } }, {}), "203.0.113.9");
  assert.equal(testing.clientIp({ headers: {} }, { ip: "198.51.100.4" }), "198.51.100.4");
  assert.equal(testing.clientIp({ headers: {} }, {}), "");
});

test("a request with no link is refused before anything is forwarded", async () => {
  const res = await teleport({
    req: { method: "POST", headers: {}, body: JSON.stringify({}) },
    res: { json: (body, status) => ({ body, status }) }
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "no link supplied");
});

test("without consent the visitor identifiers are never passed on", async () => {
  const res = await teleport({
    req: { method: "POST", headers: {}, body: JSON.stringify({ url: "https://ad.admitad.com/g/abcdefghijkl/" }) },
    res: { json: (body, status) => ({ body, status }) }
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "consent required");
  assert.equal(res.body.fallback, "https://ad.admitad.com/g/abcdefghijkl/");
});

test("unparseable bodies become an empty request", () => {
  assert.deepEqual(testing.parseBody("nope"), {});
  assert.deepEqual(testing.parseBody(""), {});
  assert.deepEqual(testing.parseBody('{"url":"x"}'), { url: "x" });
});

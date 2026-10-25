const test = require("node:test");
const assert = require("node:assert/strict");
// Tests must never use live credentials or external network access.
process.env.HODOS_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.HODOS_PROJECT_ID = "test-project";
process.env.HODOS_API_KEY = "test-key-not-secret";
const aggregate = require("./main.js");
const { testing } = aggregate;

const now = Date.parse("2026-10-24T04:00:00.000Z");
const base = {
  deviceId: "device-one",
  tripId: "trip-one",
  recordedAt: new Date(now - 60000).toISOString(),
  lat: 27.7172,
  lng: 85.324,
  accuracy: 6,
  speedKph: 30,
  magnitude: 4,
  severity: 2,
  confidence: 0.9,
  kind: "pothole",
  observation: "impact"
};

test("discard impossible locations, timestamps and severity", () => {
  assert.equal(testing.validEvent(base, now - 86400000, now), true);
  for (const invalid of [
    { lat: 91 }, { lng: -181 }, { lat: Number.NaN },
    { severity: 99 }, { accuracy: -1 }, { confidence: 2 },
    { lat: null }, { lat: "27.7172" }, { accuracy: "6" },
    { speedKph: null }, { speedKph: "30" }, { speedKph: -1 },
    { magnitude: null }, { magnitude: -2 }, { confidence: "0.9" },
    { mode: "unknown" },
    { recordedAt: "not a date" }, { recordedAt: new Date(now + 3600000).toISOString() },
    { kind: "other" }, { deviceId: "" },
    { observation: "fix", hazardRef: null }
  ]) {
    assert.equal(testing.validEvent({ ...base, ...invalid }, now - 86400000, now), false);
  }
});

test("nearby events cluster, distant defects remain distinct", () => {
  const clusters = testing.clusterEvents([
    { ...base },
    { ...base, lat: base.lat + 0.00004, lng: base.lng + 0.00003 },
    { ...base, lat: base.lat + 0.002 }
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].events.length, 2);
  assert.equal(testing.clusterEvents([base, { ...base, kind: "speed_bump" }]).length, 2);
});

test("publication requires distinct devices, not repeated submissions", () => {
  const sameDevice = testing.clusterEvents([
    { ...base },
    { ...base },
    { ...base }
  ])[0];
  assert.equal(testing.buildHazard(sameDevice, now, [], []).data.published, false);
  assert.equal(testing.buildHazard(sameDevice, now, [], []).data.passCount, 1);

  const independentlySeen = testing.clusterEvents([
    { ...base },
    { ...base, deviceId: "device-two", tripId: "trip-two" },
    { ...base, deviceId: "device-one", tripId: "trip-three" }
  ])[0];
  assert.equal(testing.buildHazard(independentlySeen, now, [], []).data.published, true);
});

test("repair evidence must be recent and located near the hazard", () => {
  const cluster = testing.clusterEvents([
    { ...base },
    { ...base, deviceId: "device-two" },
    { ...base, deviceId: "device-three" }
  ])[0];
  const id = testing.rowIdFor(cluster.centre.lat, cluster.centre.lng);
  const repair = {
    ...base, observation: "fix", hazardRef: id,
    recordedAt: new Date(now - 5000).toISOString()
  };
  const hazard = testing.buildHazard(cluster, now, [], [
    repair,
    { ...repair, deviceId: "remote-device", lat: base.lat + 1 },
    { ...repair, deviceId: "stale-device", recordedAt: new Date(now - 120000).toISOString() }
  ]);
  assert.equal(hazard.data.fixedVotes, 1);
});

test("stale published hazards are hidden only after a complete recomputation", () => {
  const rows = [
    { $id: "still-relevant", published: true },
    { $id: "expired-pothole", published: true },
    { $id: "already-hidden", published: false }
  ];
  const current = [{ rowId: "still-relevant", data: { published: true } }];
  assert.deepEqual(
    testing.stalePublishedRows(rows, current, true).map((row) => row.$id),
    ["expired-pothole"]
  );
  assert.deepEqual(testing.stalePublishedRows(rows, current, false), []);
});

test("no current evidence hides old publications only when history is complete", () => {
  const old = [{ $id: "previously-confirmed", published: true }];
  assert.equal(testing.stalePublishedRows(old, [], true).length, 1);
  assert.equal(testing.stalePublishedRows(old, [], false).length, 0);
});

test("manual presence reports cannot become independently detected potholes", () => {
  const manual = {
    ...base,
    deviceId: "manual-device",
    tripId: "manual-trip",
    accuracy: 100,
    speedKph: 0,
    magnitude: 0,
    confidence: 0.35,
    hazardRef: testing.rowIdFor(base.lat, base.lng),
  };
  assert.equal(testing.validEvent(manual, now - 86400000, now), true);
  assert.equal(testing.isManualConfirmation(manual), true);
  assert.equal(testing.isMeasuredImpact(manual), false);
  assert.equal(testing.isMeasuredImpact(base), true);
  const manualOnly = [manual, { ...manual, deviceId: "device-two" }, { ...manual, deviceId: "device-three" }];
  assert.equal(testing.clusterEvents(manualOnly.filter(testing.isMeasuredImpact)).length, 0);
});

test("manual report can only weakly strengthen an already measured hazard", () => {
  const measured = [
    { ...base },
    { ...base, deviceId: "sensor-two", tripId: "trip-two" },
    { ...base, deviceId: "sensor-one", tripId: "trip-three" },
  ];
  const cluster = testing.clusterEvents(measured)[0];
  const initial = testing.buildHazard(cluster, now, [], []).data;
  const feedback = {
    ...base,
    observation: "impact", magnitude: 0, speedKph: 0, accuracy: 100,
    confidence: 0.35, hazardRef: testing.rowIdFor(cluster.centre.lat, cluster.centre.lng)
  };
  const after = testing.buildHazard(cluster, now, [], [], [
    { ...feedback, recordedAt: new Date(now - 1000).toISOString(), deviceId: "man-one" },
    { ...feedback, recordedAt: new Date(now - 1000).toISOString(), deviceId: "man-two" },
  ]).data;
  assert.equal(after.published, initial.published);
  assert.equal(after.passCount, initial.passCount);
  assert.equal(after.deviceCount, initial.deviceCount);
  assert.equal(after.lastSeen, initial.lastSeen);
  assert.ok(after.confidence > initial.confidence);
  assert.ok(after.confidence - initial.confidence <= 0.021);
});

test("manual feedback cannot boost unrelated or stale hazards", () => {
  const cluster = testing.clusterEvents([{ ...base }])[0];
  const score = testing.buildHazard(cluster, now, [], []).data.confidence;
  const feedback = {
    ...base, observation: "impact", magnitude: 0, speedKph: 0,
    accuracy: 100, confidence: 0.35, deviceId: "man-one",
    recordedAt: new Date(now - 1000).toISOString(),
  };
  assert.equal(testing.buildHazard(cluster, now, [], [], [
    { ...feedback, hazardRef: "wrong" }
  ]).data.confidence, score);
  assert.equal(testing.buildHazard(cluster, now, [], [], [
    { ...feedback, hazardRef: testing.rowIdFor(base.lat, base.lng),
      recordedAt: new Date(now - 100000).toISOString() }
  ]).data.confidence, score);
});

test("native sensor impacts without an explicit observation field remain supported", () => {
  const nativeImpact = { ...base };
  delete nativeImpact.observation;
  assert.equal(testing.validEvent(nativeImpact, now - 86400000, now), true);
  assert.equal(testing.isMeasuredImpact(nativeImpact), true);
  assert.equal(testing.isManualConfirmation(nativeImpact), false);
});

test("whole aggregation flow publishes corroborated sensor evidence without network", async () => {
  const originalFetch = global.fetch;
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  const incidents = [
    { ...base, recordedAt: timestamp, deviceId: "sensor-one", tripId: "trip-a" },
    { ...base, recordedAt: timestamp, deviceId: "sensor-two", tripId: "trip-b" },
    { ...base, recordedAt: timestamp, deviceId: "sensor-one", tripId: "trip-c" }
  ];
  const writes = [];
  global.fetch = async (url, options = {}) => {
    assert.ok(String(url).startsWith("https://hodos-test.invalid/v1/"));
    if (String(url).includes("/events/rows")) {
      assert.equal(options.method, undefined);
      return { ok: true, json: async () => ({ rows: incidents }) };
    }
    if (String(url).includes("/hazards/rows") && options.method === undefined) {
      return { ok: true, json: async () => ({ rows: [] }) };
    }
    if (String(url).endsWith("/hazards/rows") && options.method === "POST") {
      writes.push(JSON.parse(options.body));
      return { ok: true, status: 201 };
    }
    throw new Error("Unexpected request: " + url);
  };
  try {
    const result = await aggregate({
      res: { json: (body, status = 200) => ({ body, status }) },
      log: () => {}
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.created, 1);
    assert.equal(result.body.published, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.passCount, 3);
    assert.equal(writes[0].data.deviceCount, 2);
    assert.equal(writes[0].data.published, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("whole aggregation flow hides unsupported old publications without deleting rows", async () => {
  const originalFetch = global.fetch;
  const oldHazard = { $id: "pold-hazard", published: true };
  const patches = [];
  global.fetch = async (url, options = {}) => {
    assert.ok(String(url).startsWith("https://hodos-test.invalid/v1/"));
    if (String(url).includes("/events/rows")) {
      return { ok: true, json: async () => ({ rows: [] }) };
    }
    if (new URL(String(url)).pathname.endsWith("/hazards/rows") && options.method === undefined) {
      return { ok: true, json: async () => ({ rows: [oldHazard] }) };
    }
    if (String(url).includes("/hazards/rows/") && options.method === "PATCH") {
      patches.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200 };
    }
    throw new Error("Unexpected request: " + url);
  };
  try {
    const result = await aggregate({
      res: { json: (body, status = 200) => ({ body, status }) },
      log: () => {}
    });
    assert.equal(result.body.ok, true);
    assert.equal(result.body.unpublished, 1);
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0].body, { data: { published: false } });
    assert.ok(patches[0].url.endsWith("/" + oldHazard.$id));
  } finally {
    global.fetch = originalFetch;
  }
});

test("failed hazard writes return a retryable error instead of false success", async () => {
  const originalFetch = global.fetch;
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  const incidents = [
    { ...base, recordedAt: timestamp, deviceId: "sensor-one", tripId: "trip-a" },
    { ...base, recordedAt: timestamp, deviceId: "sensor-two", tripId: "trip-b" },
    { ...base, recordedAt: timestamp, deviceId: "sensor-one", tripId: "trip-c" }
  ];
  global.fetch = async (url, options = {}) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/events/rows") && !options.method) {
      return { ok: true, json: async () => ({ rows: incidents }) };
    }
    if (path.endsWith("/hazards/rows") && !options.method) {
      return { ok: true, json: async () => ({ rows: [] }) };
    }
    if (path.endsWith("/hazards/rows") && options.method === "POST") {
      return { ok: false, status: 429 };
    }
    throw new Error("Unexpected request: " + url);
  };
  try {
    const result = await aggregate({
      res: { json: (body, status = 200) => ({ body, status }) },
      log: () => {}
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.failed, 1);
    assert.equal(result.body.created, 0);
    assert.equal(result.body.unpublished, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

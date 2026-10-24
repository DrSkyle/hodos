const test = require("node:test");
const assert = require("node:assert/strict");
const { testing } = require("./main.js");

const now = Date.parse("2026-10-24T04:00:00.000Z");
const base = {
  deviceId: "device-one",
  tripId: "trip-one",
  recordedAt: new Date(now - 60000).toISOString(),
  lat: 27.7172,
  lng: 85.324,
  accuracy: 6,
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

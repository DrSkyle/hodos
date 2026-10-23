# Hodos data

What Hodos collects, how it is structured, and what each field means. Everything
here is either public already or deliberately unreadable by clients.

## The shape of it

```
Device ──appends──► events (write-only) ──aggregate──► hazards (public map)
                                                        └──► Data tab / CSV / JSON
```

A Device never writes the map. It appends observations to `events`; a single
server-side function reads that log and derives `hazards`. That is what makes
the counts exact instead of racy.

## `events` — the observation log

Append-only, and **not readable by any client**. Only the aggregation function
(with its server key) can read it.

| Field | Type | Meaning |
| --- | --- | --- |
| `deviceId` | string | Random id for the Device. Rotates every 24 h. Contains nothing about the person. |
| `tripId` | string | Random id for one journey. Lets a single trip be treated as one witness. |
| `recordedAt` | datetime | When the observation happened (ISO 8601). |
| `lat`, `lng` | double | Position of the observation. |
| `accuracy` | double | Horizontal accuracy in metres, as reported by the platform. |
| `speedKph` | double | Ground speed at that moment. Drives the vehicle/pedestrian decision. |
| `magnitude` | double | Peak vertical acceleration above gravity, m/s². |
| `severity` | integer | 1 minor, 2 moderate, 3 severe, graded on speed-normalised magnitude. |
| `kind` | enum | `pothole`, `speed_bump`, `rough_pavement`. |
| `confidence` | double | 0–1 confidence in that single detection, from classifier margin, signal-to-noise and GPS accuracy. |
| `mode` | enum | `vehicle` or `pedestrian`. |
| `observation` | enum | `impact` (felt something), `pass` (travelled a known hazard and felt nothing), `fix` (reported repaired). |
| `hazardRef` | string | For passes and fix reports, the hazard row this relates to. |

## `hazards` — the public map

World-readable, and **only writable by the aggregation function**.

| Field | Type | Meaning |
| --- | --- | --- |
| `hazardId` | string | Stable id: the coordinate pair to four decimals (~11 m). |
| `lat`, `lng` | double | Centroid of the corroborating impacts. |
| `kind` | enum | Majority kind of its impacts. |
| `severity` | integer | Worst severity observed. |
| `passCount` | integer | Impacts that corroborate it. |
| `deviceCount` | integer | Distinct Devices. This, not raw count, is what resists gaming. |
| `dayCount` | integer | Distinct calendar days. Evidence that survives time, not one enthusiastic trip. |
| `confidence` | double | 0–1. Blends passes, devices, mean detection quality, and recency (halves over 90 days). |
| `firstSeen`, `lastSeen` | datetime | The span over which it has been observed. |
| `published` | boolean | True once it meets the corroboration bar: 3 impacts from 2 devices. |
| `clearPasses` | integer | Distinct Devices that have travelled it since the last impact and felt nothing. At 3, it reads as repaired. |
| `fixedVotes` | integer | Distinct Devices that reported it repaired. At 2, it reads as repaired. |

## How a hazard is judged repaired

Either:

- two independent Devices report it fixed, or
- three independent Devices travel the road **after the last impact** and feel
  nothing.

Pass and fix reports only count if they are newer than the last impact, so a
pothole that returns immediately resets the evidence. That is the whole point:
the map records the road getting worse *and* getting better.

## `profiles` — your personal tally

One row per identity, readable and writable **only by that identity** (row-level
permissions). Holds a small JSON document: the area name, the centre, and the
trip list. A stranger querying the table sees zero rows.

## Privacy treatment, field by field

- No name, email, phone, or account handle is ever stored. The account's address
  is derived from a recovery code the user keeps; it is not tied to a person.
- Raw sensor traces and full routes are never uploaded. Only the conclusion — an
  impact, a silent pass, a fix report — leaves the device.
- `deviceId` rotates daily, so observations cannot be linked into a history
  without the trip id, and the trip id is random per journey.
- Positions are stored at hazard precision (~11 m), not track precision.

## Getting the data out

- **In the app:** the **Data** tab lists every hazard with its evidence, and
  exports **CSV** or **JSON**. The JSON carries a `fields` block so the file is
  self-describing.
- **Directly:** `GET /tablesdb/hodos/tables/hazards/rows` with the project
  header. `events` is intentionally not readable this way.

## Aggregation

`appwrite/functions/hodos-aggregate` runs hourly and is also triggered by the app
after a trip. It reads the event log (120-day lookback), clusters impacts at
~16 m, derives every counter, and writes the map. See
[`appwrite/functions/hodos-aggregate/src/main.js`](../appwrite/functions/hodos-aggregate/src/main.js).

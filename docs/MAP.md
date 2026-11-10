# The public map

The Hodos map is the shared output of the whole system: a live view of road
conditions that independent phones have actually confirmed.

## Nothing on it is invented

The map renders **published hazards only, read live from the backend**. There is
no bundled snapshot, no seeded sample set, and no fallback file. If the backend
is empty, the map is empty — that is the correct behaviour, not a bug.

One phone cannot pad the map. Devices submit *observations*; they never write
hazard rows. A server-side aggregation function promotes an observation into a
public hazard only after independent passes from multiple devices corroborate
it. Every pin you see has survived that test.

## What the markers mean

| Marker | Meaning |
| --- | --- |
| Crimson dot | Pothole |
| Amber dot | Rough road stretch |
| Violet dot | Speed bump |
| Emerald ring | Repaired — clear passes confirmed it |

The white ring around a dot thickens with the number of confirmed passes, and a
thin outer ring appears once at least two independent devices agree. Both are
rendered from a single shared specification,
[`apps/web/public/map/hodos-layers.json`](../apps/web/public/map/hodos-layers.json),
consumed directly by the website and bundled into the Android app at build time.
Change it once and both surfaces agree.

## Quality heat

Underneath the markers the map can shade corridors by road quality, derived from
the density and severity of confirmed hazards in each ~150 m cell. The same grid
is used by the website and the app.

## Partner placements

Partner shops appear as labeled pins with an offer. They are always marked as
partner placements, never block a route, and never alter hazard data. If no
partner is published, no partner pins are shown.

## How to read the data honestly

- A hazard is a **corroborated observation**, not an engineering measurement.
- Severity and evidence scores reflect how many independent passes agreed and
  how strong the detected impacts were.
- Absence of a pin means *no confirmed report*, not *a perfect road*.
- Detection quality depends on device hardware, mounting, and vehicle
  suspension.

See [PRIVACY.md](PRIVACY.md) for what is and is not collected.

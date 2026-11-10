# Road intelligence

Beyond the shared hazard map, Hodos derives road knowledge from the journeys a
phone already records. Everything in this document is computed **on the device**
from that phone's own trails. None of it is uploaded.

## Journeys and cells

Each journey stores its location fixes, their speeds, and the sustained
vibration energy measured at each fix. Fixes and impacts are bucketed into
roughly 150 m road cells, so repeated passes over the same stretch accumulate
evidence instead of overwriting each other.

## Road quality

A cell scores 0–100 from sustained vibration and confirmed impact stress:

| Score | Grade |
| --- | --- |
| 82–100 | Smooth |
| 62–81 | Fair |
| 40–61 | Rough |
| 0–39 | Severe |

This is a relative ride-comfort measure, useful for comparing stretches and
watching a corridor change over time. It is not a pavement engineering survey
and should not be treated as one.

## Surface type

Sustained vibration signature plus impact density separates surface types:

- **Asphalt** — low sustained vibration, few discrete impacts.
- **Gravel** — frequent small impacts over a moderately rough surface.
- **Cobbles** — high sustained roughness with comparatively few discrete impacts.

A surface is only named once at least two passes agree. Below that threshold the
cell reads *Unclassified*, which is why a fresh install shows no surface data.

## Vehicle wear

Roughness multiplied by distance, scaled by the travel profile you select
(bicycle, scooter, car, mixed), produces a 0–1000 load index. The app also shows
a cost band derived from that index.

The cost band is an **illustrative estimate**, clearly labelled in the app. It
is not a quote, not insurance advice, and not a maintenance schedule.

## Deterioration watchlist

Unfixed hazards are ranked by severity, number of confirmations, and days since
first observation. The result is a prioritisation aid — the places most likely
to worsen and most worth re-checking.

## Repair value

Nearby hazards group into clusters, ranked by the share of total mapped road
stress each cluster accounts for. This answers a practical question: *which
handful of repairs would improve the most rides?*

Clusters are a planning aid for shops, fleets and civic teams. They are not a
repair specification.

## Smooth-route ceiling

For the corridors a phone has recorded, the 25% best-scoring cells give a
"smooth ceiling" — the quality a smooth-preferring route could realistically
promise on that road. It is a score, not a router: it tells you whether a
smooth-route product would be worth building on that corridor before anyone
builds one.

## Limits worth stating plainly

- Surface inference is per-device until trails are synced; it is not a global
  ground truth.
- Cells need multiple passes to be meaningful. Early data is thin by design.
- Quality, wear and repair value describe the roads a phone has driven, not the
  whole network.

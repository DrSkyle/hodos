# Hodos — specification

The design decisions behind Hodos, in the order they were settled.

## Intent

Give a neighbourhood a live, trustworthy map of its road defects, built without
anyone filing a report, from the phones people already carry.

## Goals

- Detect road impacts passively, with no user reporting.
- Keep raw sensor data on the device; publish only coarsened, corroborated hazards.
- Work on ordinary phones, without an app store.
- Publish a hazard only when several independent passes agree, so the map is
  trustworthy rather than noisy.
- Produce an artefact a resident can hand to their road authority.

## Non-goals

- A complaint channel. Hodos is a sensor, not a 311 form.
- Door-to-door navigation or turn-by-turn routing.
- Whole-road quality grading. Hodos marks discrete hazards.

## Anti-goals

- Uploading raw accelerometer traces.
- Requiring an account, an email, or a name to contribute.
- Showing a hazard on one person's say-so.

## Constraints

- **Platform:** the web platform fires motion and location events only while the
  document is visible. Background sensing cannot be done in a browser.
- **Time:** built inside a one-week hackathon window.
- **Trust:** anonymous contribution means the corroboration model has to carry
  the trust, not identity.

## Approaches considered

**Vehicle-mounted accelerometer detection** (chosen). A phone rides in a
vehicle; vertical impact peaks mark potholes, speed bumps and rough pavement.
This is the method the published research converges on (Pothole Patrol,
Nericell, Mednis et al.). Vehicle speed also gives free false-positive
rejection.

**Pedestrian pocket sensing.** Wider everyday coverage, but a walking signal is
noisy — hard to separate a real defect from a step — and all-day pocket sensing
needs background execution the browser does not provide.

**Multi-signal opportunistic sensing.** Everything above plus microphone and
speed-derived brake events. Richest, but the most moving parts for the time
available.

The vehicle-mounted path was chosen as the accurate, demoable core, with the
pipeline shaped so the other signal types are additions rather than rewrites.

## How it was decided, and by whom

- Hazard scope: impact-type road defects (potholes, speed bumps, rough
  pavement). Later signals extend the same pipeline. *(product decision)*
- Sensing mode: vehicle-primary. *(product decision)*
- Platform: installable PWA, on-device detection, events-only upload.
  *(product decision)*
- Audience: residents and cyclists as users; the road authority as the
  accountability target; an exportable report as the impact artefact.
  *(product decision)*
- Definition of done: deployed and reachable, tested, CI-built, with real data
  captured on a real route.
- Recording model: an explicit foreground trip, because the platform forbids
  anything else. *(builder call, forced by the platform)*
- Merge distance, thresholds and confidence curve: builder calls, set from the
  published detection research and recorded in `packages/core/src/`.

## What is left to the builder

- Tuning thresholds against real local data.
- Server-side aggregation to replace the client merge.
- Road-centreline snapping, so a hazard sits on the road rather than beside it.
- A native foreground service for genuinely background sensing on Android.

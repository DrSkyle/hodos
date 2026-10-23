# Hodos privacy policy

Hodos maps road defects without knowing who found them.

## What is collected

When you record a trip, Hodos reads two things:

- **Motion** from the phone's accelerometer, to feel impacts.
- **Location**, to know where each impact is.

Impacts — a position, a magnitude, a severity, the time, and the estimated
speed — are sent to the server. **Raw sensor traces are never sent.** Detection
runs on the phone; only the conclusion leaves it.

## What is never collected

- No name, no email, no phone number, no account.
- No raw accelerometer or GPS traces.
- No advertising identifiers, no third-party trackers, no analytics SDKs.
- No location history beyond the individual impacts you contribute.

## The device identifier

To tell corroborating observations apart, Hodos stores a random identifier on
your device. It contains nothing about you, and it **rotates every 24 hours**.
It is not linked to any account, and it is not sent anywhere except alongside
the impacts it labels.

## Coarsening

Before an impact is stored it is reduced to a point on the road. The public map
shows merged hazards, not the path you drove, and only hazards confirmed by
several independent passes from distinct devices are shown at all.

## The event log

The `events` table is write-only. A client can append an observation and can
never read the log back. Only the server-side aggregation process can read it.

## Your control

Recording only happens while you have explicitly started a trip, and stops when
you end it. Uninstalling the app or clearing site data removes the local
identifier. There is no server-side profile to delete, because none is kept.

## Questions

This is a student project built for Neighborhood Hacks 2026. If you have a
privacy question, open an issue on the repository.

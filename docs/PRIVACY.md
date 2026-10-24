# Hodos privacy policy

*Updated 24 October 2026*

Hodos is an Android road-hazard mapping app. Automatic mapping requires permission to read location, motion sensors and activity recognition while the background mapping service is enabled. You can disable it in the app or revoke permissions in Android settings; the public map is browsable without enabling recording.

## Data collected

The phone analyzes accelerometer readings and location fixes locally. **Raw accelerometer streams and full travel routes are not uploaded.** Compact road events may be sent to Appwrite: timestamp, coordinates, GPS accuracy, estimated speed, estimated defect type and severity, detector score, observation type (impact, clear-road pass or repair), a random journey ID and a random installation ID.

Location observations are potentially sensitive even without names. The installation ID is a pseudonym stored on your device and **persists for the life of the installation**, so submissions may be linked across journeys. It is not your advertising ID or a value derived from an email or phone number. The server currently accepts client-supplied pseudonyms, and cannot guarantee each corresponds to a unique physical device.

## Storage and access

Public aggregated hazard records are readable by anyone. The individual observation log is not publicly readable through the client API. Hodos caches recently fetched hazard data and up to 50 local trip summaries. Events queued for upload are stored in an app-private SQLite database **without separate application-level encryption**. Standard platform device backups may affect local data retention.

The server currently aggregates up to 120 days of event history; this calculation window is **not a deletion policy**. An automatic deletion schedule for stored event records has not yet been implemented. Uninstalling Hodos or clearing its local data does not erase already submitted server observations.

No advertising or analytics SDK is intentionally included in the native app. Hosting providers may handle technical connection metadata as necessary to operate the service.

## Your choices

You can browse without contributing observations, disable automatic mapping at any time, and clear local app data through Android settings. For questions about a submitted observation or a server-side deletion request, contact the project maintainers privately using the contact information on [GitHub](https://github.com/DrSkyle/hodos). Avoid posting sensitive locations publicly.

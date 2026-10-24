# Privacy policy

*Hodos · Updated 24 October 2026*

Hodos uses your phone's motion sensors and location to identify possible road defects. You can view the hazard map without enabling automatic mapping.

## Location and motion

When automatic mapping is enabled, Hodos reads motion and location signals to recognize journeys and detect unusual road impacts. The analysis runs on your phone. We do not upload raw accelerometer samples or complete GPS routes.

For each road observation, Hodos may send a location, time, GPS accuracy, estimated speed, hazard type, severity and detection score. Repair reports and clear-road observations can be linked to a known hazard.

## Identifiers

The app creates a random installation identifier and a separate identifier for each journey. The installation identifier persists in local app data and accompanies submitted observations so that repeated reports can be compared. It does not come from your name, phone number or advertising ID.

Submitted identifiers are pseudonymous, not independently verified proof of unique devices.

## Storage

Observations are stored in Appwrite. Individual observations are not publicly readable through the app; the resulting aggregated hazard map is public.

On your phone, Hodos keeps up to 50 journey summaries and a cache of downloaded map hazards. Automatic observations awaiting upload are kept in app-private SQLite storage. This queue does not currently have separate application-level encryption.

The aggregation service examines a rolling 120-day window. That window does **not** automatically delete older observations; a server-side event deletion schedule has not yet been established.

## Your controls

You can turn off automatic mapping in Hodos or revoke its location and activity-recognition permissions through Android settings. You can also clear local app data or uninstall the app. Doing so removes locally stored information but does not delete observations already sent to the server.

Hodos does not intentionally include advertising or third-party analytics SDKs. Hosting providers may process technical connection data needed to operate their services.

## Contact

For questions about your data or a deletion request, contact the maintainers through the [Hodos repository](https://github.com/DrSkyle/hodos). Please avoid sharing sensitive locations in public issues.

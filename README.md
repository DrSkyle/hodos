# Hodos

**The road maps itself.**

Hodos is an open-source Android app that uses motion and location measurements to identify likely potholes, speed bumps and rough pavement during ordinary journeys. Repeated road observations contribute to a shared map that people can explore and improve.

**[Website](https://hodos.devilabs.dev)** · **[Android downloads](https://github.com/DrSkyle/hodos/releases)** · **[Report an issue](https://github.com/DrSkyle/hodos/issues)**

## Features

- **Automatic mapping:** opt-in journey detection using Android activity recognition and on-device motion analysis.
- **Community map:** browse road hazards, confidence scores, severity and reports.
- **Feedback:** confirm a hazard or report a repair.
- **Offline support:** cache public hazards and queue automatic observations for later upload.
- **Privacy controls:** raw motion samples stay on your phone; only compact geolocated observations are shared.

Hodos is in **beta**. Detection is heuristic rather than field-validated: vehicle type, phone placement, speed and sensor variation affect the results. Confidence is a relative score, not a calibrated probability. The app is not a replacement for safe driving or road inspections. Submitted installation IDs are pseudonymous and cannot yet be verified as unique physical devices.

## Development

Android (JDK 17, Android SDK 35):

```sh
cd apps/web/android
./gradlew :app:assembleDebug
```

Website and domain tests (Node 20+, pnpm):

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
node --test appwrite/functions/hodos-aggregate/src/main.test.js
pnpm --filter @hodos/web build
```

Source: `apps/web/android/` contains the Android app, `apps/web/` contains the landing page, `packages/core/` contains signal-processing reference code and tests, and `appwrite/functions/` contains the road-map aggregation service.

Read the [privacy policy](docs/PRIVACY.md). Contributions and test reports are welcome through GitHub Issues.

Hodos is built by **Devilabs** and licensed under [MIT](LICENSE).

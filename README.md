# Hodos

<p align="center">
  <img src="brand/icon.svg" alt="Hodos icon" width="120" height="120" />
</p>

<p align="center">
  <strong>The road maps itself.</strong><br />
  Passive, crowdsourced road-hazard mapping for your neighborhood.
</p>

<p align="center">
  <a href="https://hodos.devilabs.dev">Website</a> •
  <a href="https://github.com/DrSkyle/hodos/releases">Android Releases</a> •
  <a href="docs/PRIVACY.md">Privacy Policy</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a>
</p>

---

## What is Hodos?

**Hodos** is an open-source Android app that detects road hazards—such as potholes, speed bumps, and rough pavement—using on-device motion readings collected during everyday journeys.

Turn on automatic mapping, keep your phone with you, and drive as you normally would. Hodos detects road surface impacts using your phone's accelerometer and gyroscope, and queues compact observations for a shared community map. Repeated observations from independent trips corroborate hazards and distinguish real defects from one-off bumps.

- **Zero Manual Effort:** Runs quietly in the background; no tapping or reporting while driving.
- **Privacy by Design:** Raw motion traces stay in device RAM. No continuous GPS routes or breadcrumbs are logged.
- **Multi-Device Corroboration:** Hazards are only published when multiple independent trips corroborate the defect.
- **Offline Resilience:** Downloads 20 km Wi-Fi cached vector basemaps (OpenFreeMap) and maintains a local SQLite hazard cache.

---

## Features

- **Automatic Motion Detection:** Uses Android Activity Recognition to arm sensor sampling only during vehicular transit.
- **Interactive Vector Map:** MapLibre-powered Android map with nearby hazards, severity classifications, and pass corroboration counts.
- **Community Verifications:** Confirm active hazards or mark repaired road segments.
- **Offline Maps:** Wi-Fi-only automated tile pack caching (20 km radius, zoom levels 8–13) with quota caps (45 MiB / 2,400 tiles) to respect open basemap infrastructure.
- **Privacy First:** Pseudonymous installation identifiers, quantized location coordinates, and no third-party tracking or advertising SDKs.

---

## Architecture

The project is organized as a monorepo:

- **`apps/web/android`**: Native Android app written in Kotlin and Jetpack Compose, featuring MapLibre Android SDK, background service lifecycle (`HodosService`), and SQLite outbox.
- **`apps/web`**: Lightweight product showcase with an interactive on-device sensor simulator (oscilloscope) and live hazard map inspector built with Vite and TypeScript.
- **`packages/core`**: Shared detection library for sensor signal processing, Butterworth filtering, jerk thresholding, and DBSCAN spatial clustering.
- **`appwrite/functions`**: Server-side aggregation functions (`hodos-aggregate`) that ingest anonymous observations and generate the public hazard map layer.

---

## Development & Building

### Prerequisites

- **Node.js** v20+ and **pnpm** v10+
- **JDK 17 or 21**
- **Android SDK** (API Platform 35, Build-Tools 34.0.0+)

### Android App

To build and run tests for the Android application:

```sh
cd apps/web/android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The compiled debug APK will be available in `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.

### Web & Shared Packages

To build and run tests for the web application and core signal algorithms:

```sh
# Install workspace dependencies
pnpm install

# Typecheck and run unit tests
pnpm -r typecheck
pnpm -r test

# Run backend aggregation tests
node --test appwrite/functions/hodos-aggregate/src/main.test.js

# Build web static bundle
pnpm --filter @hodos/web build
```

---

## Disclaimer

Hodos identifies potential road hazards. Results depend on device hardware, vehicle suspension, mounting position, and road conditions; they are not a substitute for driver vigilance or municipal road engineering inspections.

---

## Licensing

Hodos uses a dual-licensing framework to balance open-source transparency with dataset protection:

- **Software Code:** [MIT License](LICENSE) — The Android application, web viewer, and signal detection libraries are free and open source.
- **Road Condition Dataset:** [CC BY-NC-SA 4.0](LICENSE) — All crowdsourced defect coordinates, road roughness layers, and telemetry are freely accessible for personal, civic, and non-commercial research use. Commercial use (fleet routing, logistics, insurance, or contractor dispatch) requires an enterprise commercial license from [Devilabs](https://hodos.devilabs.dev).

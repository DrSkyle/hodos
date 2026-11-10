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
  <a href="docs/MAP.md">The Map</a> •
  <a href="docs/ROAD-INTELLIGENCE.md">Road Intelligence</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a>
</p>

---

## What is Hodos?

**Hodos** is an open-source Android app that reads the road through your phone as you drive, then turns what it learns into a shared, live map of road conditions.

Turn on automatic mapping, keep your phone with you, and drive as you normally would. Hodos detects road surface impacts using your phone's accelerometer and gyroscope, and queues compact observations for a shared community map. Repeated observations from independent trips corroborate hazards and distinguish real defects from one-off bumps.

Beyond the shared map, Hodos turns your own journeys into road knowledge: which roads are asphalt, gravel or cobbles, how smooth each corridor is, how much wear they put into your vehicle, which hazards are getting worse, and which few repairs would improve the most rides.

- **Zero Manual Effort:** Runs quietly in the background; no tapping or reporting while driving.
- **Privacy by Design:** Raw motion traces stay in device RAM. No continuous GPS routes or breadcrumbs are logged. Everything derived from your journeys stays on your phone.
- **Multi-Device Corroboration:** Hazards are only published when multiple independent trips corroborate the defect.
- **Offline Resilience:** Downloads 20 km Wi-Fi cached vector basemaps (OpenFreeMap) and maintains a local SQLite hazard cache.

---

## Features

- **Automatic Motion Detection:** Uses Android Activity Recognition to arm sensor sampling only during vehicular transit.
- **Five destinations:** *Map* (live hazards), *Drive* (mapping status and trips), *Roads* (surface mix, corridor quality, vehicle wear), *Insights* (deterioration, repair value, smooth-route ceiling) and *You* (saved roads, perks, privacy).
- **Interactive Vector Map:** MapLibre-powered Android map with nearby hazards, severity classifications, and pass corroboration counts.
- **Road Quality Analysis:** On-device cells (~150 m) infer surface type, score corridor quality 0–100, and estimate vehicle wear from roughness × distance.
- **Community Verifications:** Confirm active hazards or mark repaired road segments.
- **Offline Maps:** Wi-Fi-only automated tile pack caching (20 km radius, zoom levels 8–13) with quota caps (45 MiB / 2,400 tiles) to respect open basemap infrastructure.
- **Privacy First:** Pseudonymous installation identifiers, quantized location coordinates, and no third-party tracking or advertising SDKs.

## Documentation

- [The public map](docs/MAP.md) — what the markers mean and why nothing is seeded.
- [Road intelligence](docs/ROAD-INTELLIGENCE.md) — quality, surface, wear, deterioration and repair value, with their limits.
- [Privacy policy](docs/PRIVACY.md) — what leaves your phone and what never does.
- [Security policy](SECURITY.md) — reporting and release integrity.


---

## Architecture

The project is organized as a monorepo:

- **`apps/web/android`**: Native Android app written in Kotlin and Jetpack Compose, featuring MapLibre Android SDK, background service lifecycle (`HodosService`), SQLite outbox, and on-device road-quality analysis (`RoadQuality`).
- **`apps/web`**: The website and live hazard map, built with Vite and TypeScript. The map consumes live published hazards from the backend; there is no static snapshot.
- **`apps/web/public/map/hodos-layers.json`**: The single shared marker and heat-layer specification. Both the website and the Android app render hazards from this one file, so the map reads identically on both.
- **`packages/core`**: Shared detection library for sensor signal processing, Butterworth filtering, jerk thresholding, and DBSCAN spatial clustering.
- **`appwrite/functions`**: Server-side aggregation functions (`hodos-aggregate`) that ingest anonymous observations and produce the public hazard map layer, plus anonymous partner footfall counting.

---

## Data you will actually see

The public map renders **live corroborated hazards only**. Nothing is seeded, sampled, or mocked: an empty backend renders an empty map. Individual devices never write hazard rows — the aggregation function promotes an observation only after independent trips corroborate it, so the map cannot be padded by one phone.

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

# Hodos

**The road maps itself.**

Hodos is an Android-first, open-source project for passively mapping potholes,
speed bumps and rough pavement. When people travel normal routes, their phones
detect likely road defects locally, append compact observations to a shared
event log, and corroborate hazards before publishing them on a public map.

**Website:** [hodos.devilabs.dev](https://hodos.devilabs.dev) — the landing page, not an interactive web app.

**Android APK:** [latest existing release](https://github.com/DrSkyle/hodos/releases/latest).
The new Kotlin interface is developed on a separate branch while build and
real-device compatibility are checked. **Do not assume the existing release is
the new native version.**

## Android-first architecture

- **Kotlin / Jetpack Compose / Material 3** — mobile navigation, map-first screens,
  journey history, native sheets and large accessible touch targets.
- **MapLibre Native** — vector map and interactive hazard markers on Android.
- **Existing Java motion pipeline** — accelerometer + location samples and
  passive automatic trip detection in an Android foreground service.
- **Appwrite** — publicly readable aggregated hazards, append-only events,
  private profiles in the previous Capacitor app.
- **Offline map cache** — browse previously fetched hazards without a network.
  Automatic journey observations are saved in a durable SQLite outbox and retried while mapping is enabled. Manual confirmation actions still require connectivity.

The website is a lightweight product landing page powered by Vite.
The original browser app source is preserved temporarily in
\`apps/web/src/main.ts\` for account and recovery-code migration.

## Build

Android (JDK 17, Android SDK 35):

\`\`\`sh
cd apps/web/android
./gradlew :app:assembleDebug
\`\`\`

Website:

\`\`\`sh
pnpm install
pnpm --filter @hodos/web build
\`\`\`

Tests:

\`\`\`sh
pnpm -r test
pnpm -r typecheck
\`\`\`

**Android build and release cautions:** see [docs/ANDROID.md](docs/ANDROID.md)
for permission flows, manual acceptance, old identity migration and signing.
CI debug APKs are for testing; stable installation needs a consistent release key.

## Core design

1. **Sense locally.** The device estimates gravity and band-passes the vertical
   residual, suppressing motion that looks unlike a road defect.
2. **Classify.** Peak, pulse shape, jerk and lateral motion help differentiate
   potholes, speed bumps and rough pavement.
3. **Append evidence.** The phone sends compact observations to a write-only
   log, rather than directly changing the shared hazard map.
4. **Aggregate.** The backend combines corroborated observations from
   independent devices; recently clear journeys and repair reports help
   mark hazards resolved.
5. **Explain.** Users can inspect confidence, how many journeys confirmed a
   hazard, and its current reported status.

## Source layout

\`\`\`text
apps/web/android/  native Android app, including preserved Java detector
apps/web/          responsive product landing site and migration-era web code
packages/core/     domain algorithm and test coverage
appwrite/          provisioning and aggregation
docs/              research, privacy, architecture, release checklist
\`\`\`

## Privacy

Raw accelerometer readings stay on the device. Hodos submits road observations
with locations needed for the shared map. Activity recognition, background
location and a foreground service are used only with explicit Android
permissions. Read [the privacy policy](docs/PRIVACY.md) and
[data dictionary](docs/DATA.md).

## Status

The native map and landing-page refresh are under development on a dedicated branch. Deployment to \`main\` and a stable signed APK
are deliberately held until CI, migration and device tests succeed. The
original recovery-code identity must remain recoverable for existing users.

MIT licensed. Hodos is a project by Devilabs.

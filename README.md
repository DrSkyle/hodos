# Hodos

> **Android beta notice (24 October 2026):** The `v1.1.4-beta.1` installer has a reported immediate-launch crash and missing launcher artwork. **Do not install this beta.** The next build is blocked until the original branding files are restored and Android emulator startup tests pass. A successful Gradle compile is not proof of device compatibility.

**The road maps itself.**

Hodos is an Android app that maps potential potholes, speed bumps and rough pavement from motion readings collected during everyday journeys.

Turn on automatic mapping, keep your phone with you and drive as you normally would. Hodos checks for unusual road impacts on the device and sends compact observations to a shared map. Repeated observations help distinguish road hazards from one-off bumps.

[Website](https://hodos.devilabs.dev) · [Android releases](https://github.com/DrSkyle/hodos/releases) · [Privacy](docs/PRIVACY.md)

## Features

- **Automatic road mapping** with Android activity recognition and on-device sensor processing
- **Interactive map** with nearby hazards, severity and supporting reports
- **Community updates** to confirm a hazard or report a repair
- **Offline support** for cached hazards and queued road observations

## Development

The Android app uses Kotlin, Jetpack Compose and MapLibre. The website is built with Vite. Appwrite stores road observations and generates the public hazard map.

**Build the Android app** with JDK 17 and Android SDK 35. First upload the three **unmodified original** PNGs into `apps/web/public/`: `hodos-icon.png`, `hodos-round.png`, and `hodos-wordmark.png`. The build generates all Android icon densities and the onboarding/brand resources from these files. The build intentionally fails rather than packaging reduced or corrupt replacements.

```sh
cd apps/web/android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

**Build and test the website and shared detection code** with Node.js and pnpm:

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
node --test appwrite/functions/hodos-aggregate/src/main.test.js
pnpm --filter @hodos/web build
```

The code lives in `apps/web/android`, `apps/web`, `packages/core` and `appwrite/functions`.

Hodos identifies *potential* hazards. Results depend on the phone, vehicle, mounting position and road conditions; they aren't a substitute for attention at the wheel or professional road inspections.

[Contribute or report a problem](https://github.com/DrSkyle/hodos/issues).

Developed by **Devilabs** · [MIT License](LICENSE)

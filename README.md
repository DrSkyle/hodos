# Hodos

> **Android beta notice (24 October 2026):** Do **not** install the known-broken `v1.1.4-beta.1` build. Newer builds restore the original branding and pass Android emulator startup checks. Real-phone GPS, background journey recording, offline tile coverage and road detection **still require field verification**; use the latest beta from [Releases](https://github.com/DrSkyle/hodos/releases), not an older installer.

**The road maps itself.**

Hodos is an Android app that maps potential potholes, speed bumps and rough pavement from motion readings collected during everyday journeys.

Turn on automatic mapping, keep your phone with you and drive as you normally would. Hodos checks for unusual road impacts on the device and sends compact observations to a shared map. Repeated observations help distinguish road hazards from one-off bumps.

[Website](https://hodos.devilabs.dev) · [Android releases](https://github.com/DrSkyle/hodos/releases) · [Privacy](docs/PRIVACY.md)

## Features

- **Automatic road mapping** with Android activity recognition and on-device sensor processing
- **Interactive map** with nearby hazards, severity and supporting reports
- **Community updates** to confirm a hazard or report a repair
- **Offline support** for cached hazards and queued road observations
- **Nearby offline map regions** (20 km around your location, zoom 8–13): automatic on validated Wi-Fi after location permission, with manual save and removal controls

## Offline maps

The native Android Mapping screen offers a **Wi-Fi-only** automatic map download after a user-authorized location fix. The saved square region extends approximately 20 km from the center in each direction (zoom 8–13). Two recent regions are retained; earlier ones are deleted as you move. Users can disable automatic downloads, save the nearby area manually, or remove packs. Hodos keeps locally cached hazard records independently of map tiles.

Basemaps use [OpenFreeMap](https://openfreemap.org/) under its [offline tile-download terms](https://openfreemap.org/tos/). Each pack is paused before 2,400 tiles or 45 MiB, and all map requests are limited to four parallel connections with an application-identifying User-Agent. The build does **not** use bulk downloads from CARTO or OpenStreetMap's public tile server.

Offline regions are only guaranteed at the downloaded zoom levels and after the on-device download is shown as complete. Downloading stops over cellular, and storage use is visible in the Mapping tab. Hazard sharing, new hazards, and unmapped locations still require connectivity.

## Staying involved

- **My Roads:** save a public map report locally, then revisit its community-confirmed status from the You tab. Saved IDs stay on this phone.
- **Road diary:** private local summaries for each week, never a full route history.
- **Contributions:** ordinary journeys can help improve the map when automatic mapping is explicitly enabled; reporting while operating a vehicle is not encouraged.

## License

Hodos' current maintained code is released under **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**. This includes the client, website, shared detection library and backend aggregation code. If you distribute a modified version or run a modified AGPL-covered network service, review and comply with the source-provision obligations in the license.

Earlier copies of Hodos released under the MIT License remain available under their original grant; see [the preserved historical MIT notice](LICENSES/MIT-legacy.txt). The license change does not revoke those earlier permissions or erase third-party copyright. See [third-party notices](THIRD_PARTY_NOTICES.md).

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

Developed by **Devilabs** · [GNU AGPL-3.0-only License](LICENSE)

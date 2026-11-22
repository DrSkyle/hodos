# Hodos

<p align="center">
  <img src="brand/icon.svg" alt="Hodos icon" width="112" height="112" />
</p>

<p align="center">
  <strong>The road maps itself.</strong><br />
  Passive road-condition intelligence, GPS-verified live road alerts, and zero-commission local shop pins — with zero user accounts, zero ad SDKs, and zero route uploads.
</p>

<p align="center">
  <a href="https://hodos.devilabs.dev">Website</a> •
  <a href="https://hodos.devilabs.dev/map">Live Map</a> •
  <a href="https://hodos.devilabs.dev/app">Web App</a> •
  <a href="https://github.com/DrSkyle/hodos/releases/latest">Android APK</a> •
  <a href="https://hodos.devilabs.dev/partners">List a Shop (Free)</a> •
  <a href="AGENTS.md">AGENTS.md</a> •
  <a href="https://hodos.devilabs.dev/privacy.html">Privacy</a>
</p>

---

## Why Hodos Exists

Conventional maps tell you where a road *is* — not whether it will bend your rim, shred your tyres, flood in the rain, or hide an unmarked speed bump. Legacy platforms also harvest driver identities, run pay-to-rank ad auctions over local businesses, and inject sponsored popups over navigation.

**Hodos** takes a different approach:

- **Passive sensing on ordinary phones:** Turn on mapping and drive normally. A single deterministic signal-processing engine (`@hodos/core`) runs identically on **Android (Kotlin + Jetpack Compose)** and the **Web App (`/app`)**, isolating vertical road impacts, grading severity, and inferring surface quality locally on-device.
- **No seeded or fake data:** An empty database renders an empty map. Every published pothole, rough stretch, live alert, and local shop pin comes from real backend records.
- **Private by architecture:** Zero user accounts, zero login walls, zero advertising IDs, zero third-party analytics SDKs. Raw accelerometer traces and full GPS routes never leave your device, and Android automatically trims the first and last **250 m** of every journey before saving locally.

---

## Trust, Corroboration & Anti-Spam Rules (Zero Magic)

We do **not** blindly trust a single tap or a single phone. Every state transition on the public map follows explicit quorum and GPS-verification rules:

| Signal | Publishing Rule | Repair / Clear Rule | Anti-Spoof / Privacy Gate |
| --- | --- | --- | --- |
| **Pothole / Rough Road / Speed Bump** | **≥ 3 passes** across **≥ 2 distinct devices** (`hodos-aggregate`). One phone can never publish a defect alone. | **≥ 2 independent GPS-verified repair votes** (within 500 m, GPS ≤ 250 m) **OR ≥ 3 distinct silent smooth passes** after the last impact. A single click never deletes a corroborated pothole. | Coordinates quantized into H3 spatial cells; raw traces never uploaded; 250 m start/end route trim on Android. |
| **1-Tap Live Road Alert** (`Police`, `Jam`, `Blocked`, `Flood`) | Published immediately with **live GPS fix (accuracy ≤ 150 m)** proof-of-presence; labeled **Unverified** until a 2nd independent driver confirms (**Verified**). | **Unverified (1 reporter):** 1 independent nearby driver (within 1.5 km) clears it (1v1 anti-fake tie-breaker). **Verified (≥ 2 reporters):** requires **≥ 2 independent nearby drivers** to clear before automatic TTL expiration. | 90-second per-device cooldown; auto-expires cleanly when stale; no personal identifier attached. |
| **Local Shop Pin** | Real local shops only (name, one-line offer, street address, answerable phone, map coordinates). Minimum 8 m physical separation prevents stacking. | Expires automatically when active days end; removable if fake, unlawful, or misleading. | Anonymous monthly distinct-device pass counter only; zero driver identities or routes ever exposed to shops. |

---

## Why Local Shops List on Hodos (Not Just Google Maps)

Placing an initial shop pin on Hodos is **free everywhere**, with **0% commission** and **zero pay-to-rank ad auctions**.

- **Direct AI-Agent API visibility:** Every active shop pin is returned by the Hodos Agent API (`partners`, and attached to `hazards` and `roads` corridor queries). When a driver asks an AI assistant for a nearby tyre shop, garage, EV charger, pharmacy, or food stop, your real listing is returned directly via [`AGENTS.md`](AGENTS.md).
- **Transparent map display (Road-First, Never Ad Clutter):**
  - Your pin goes live immediately on `/map`, `/app`, Android APK, and `/garage` — clicking **See it on the map** jumps directly to your pin and opens its card.
  - In uncrowded areas (≤ 12 shops in view), every live shop renders cleanly with a quiet architectural **squircle category badge** (never competing with circular red/amber hazard dots or warning-shaped live radar badges).
  - In dense streets (> 12 shops in one viewport), nearby pins automatically cluster and prioritize **Roadside Essentials** (Tyre/Auto, EV/Fuel, Pharmacy) and **Free Rider Perks** so road hazards always remain readable. Drivers can also toggle **`Shops: All` / `Shops: Essentials` / `Shops: Off`** in 1 tap.
- **Post-trip driver utility:** After a rough trip (never while moving), the app quietly surfaces nearby tyre & alignment shops offering free pressure/alignment checks.
- **Real anonymous footfall:** Save your **Pin Reference ID** after placing a pin to check how many distinct devices drove past your door each month.

> **Referrals status:** After helping **289 people earn ₹2,00,000+ (2 lakh+)**, the referral programme is currently paused while initial shop pins are free globally. Join the reopening waitlist at [hodos.devilabs.dev/referrals](https://hodos.devilabs.dev/referrals).

---

## Visual Grammar (Identical Across Web & Android APK)

| Shape | Meaning | Layer Priority |
| --- | --- | --- |
| **Circles** | Pavement defects (`Pothole`, `Rough road`, `Speed bump`, `Repaired`) | Top safety layer |
| **Warning Geometry** (Shield / Diamond / Octagon / Ripple) | Live 1-tap road radar (`Police`, `Jam`, `Blocked`, `Flood`) | Top alert layer |
| **Quiet Rounded Squares (Squircles)** | Local shops (`Auto & Tyre`, `EV & Fuel`, `Pharmacy`, `Food & Café`, `Local stop`) + stacked cluster badge | Beneath hazards (`minzoom 10`, auto-clustered) |

---

## For AI Agents (`AGENTS.md` & Metered API)

Hodos ships a raw, machine-native specification at [`AGENTS.md`](AGENTS.md) (served live at `https://hodos.devilabs.dev/AGENTS.md`, summary at [`llms.txt`](apps/web/public/llms.txt)):

- **Zero subscriptions, prepaid micro-USD metering** (`1,000,000 micro-USD = $1.00`): `manifest`, `provision`, `credits`, `report` are free; `garage` and `partners` are `$0.00008`; `hazards` is `$0.00010`; `roads` is `$0.00030`; `graph` is `$0.00120`.
- **Mandatory user consent gate** and verbatim permission disclosure before provisioning or spending credit.
- **Android APK install & test playbook** included for coding/device agents when users ask them to install or evaluate Hodos on Android.

---

## Architecture (Monorepo)

| Path | Role |
| --- | --- |
| `packages/core` | Shared deterministic road-impact detector, fused motion-state estimator (`still`, `walking`, `cycling`, `in_hand`, `vehicle`), rolling MAD adaptive threshold, ASTM E1926 IRI proxy, and cross-platform parity fixtures. |
| `apps/web` | Main website, live hazard map (`/map`), browser PWA (`/app`), Garage (`/garage`), free shop pin placement (`/partners`), referral waitlist (`/referrals`), and legal docs (`/privacy.html`, `/legal/partner-agreement.html`). |
| `apps/web/android` | Native Android app (Kotlin + Jetpack Compose + MapLibre Android SDK), foreground/background sensing (`HodosService`), 250 m start/end privacy trim, offline 20 km OpenFreeMap basemap cache, and SQLite outbox. |
| `apps/india` | Regional web build aligned with global free initial shop pins and paused referrals. |
| `appwrite/functions/hodos-aggregate` | Multi-device H3 spatial corroboration, decay, live alert TTL, and anonymous partner pass-count aggregation. |
| `appwrite/functions/hodos-api` | Metered AI-agent API, free global shop pin placement/status, and live road data endpoints. |
| `appwrite/functions/hodos-affiliate` | Garage catalogue proxy and isolated newsletter waitlist handler. |
| `appwrite/functions/hodos-teleport` | Consent-gated server-side affiliate resolver. |

---

## Development & Verification

### Prerequisites

- **Node.js** 20+ and **pnpm** 10+
- **JDK 17 or 21** and **Android SDK** (compileSdk 35, Build-Tools 34.0.0+)

### Commands

```sh
# Install dependencies
pnpm install

# Build web apps
pnpm --filter @hodos/web build
pnpm --filter @hodos/india build

# Run shared core & workspace tests (225+ parity/signal tests)
pnpm -r test

# Run all Appwrite backend function tests (100 tests)
node --test appwrite/functions/*/src/main.test.js

# Run Android unit tests & assemble debug APK
cd apps/web/android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Debug APK output: `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.
Signed production releases are published via GitHub Releases (`v*` tags) at [github.com/DrSkyle/hodos/releases/latest](https://github.com/DrSkyle/hodos/releases/latest).

---

## Disclaimer

Hodos identifies potential road defects and driver-reported alerts. Results depend on phone sensors, mounting position, vehicle suspension, and road conditions; Hodos is never a substitute for driver attention or official road-safety inspections.

---

## Licensing

Hodos operates under a strict **Source-Available Proprietary & Non-Compete License ([HSAL-1.0](LICENSE))** so anyone can inspect and audit our privacy guarantees while protecting Hodos from unauthorized commercial clones:

- **Software Code ([HSAL-1.0](LICENSE)):** Publicly viewable for security/privacy auditing, personal non-commercial use, and upstream PRs to `github.com/DrSkyle/hodos`. Commercial use, redistribution, app-store republishing, scraping, competing road-mapping/shop-pin services, and AI/ML model training on Hodos code or data are strictly prohibited without a signed written commercial license from **Devilabs (Minerva Corporation)**.
- **Road Condition Dataset ([CC BY-NC-SA 4.0 + Non-Compete](LICENSE)):** Free for personal, academic, and civic non-commercial viewing. Commercial fleet, routing, logistics, ride-hailing, or insurance licensing: **contact@devilabs.dev**.

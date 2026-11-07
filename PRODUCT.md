# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

- **Data Contributors (Drivers & Commuters Worldwide):** Everyday drivers, motorcyclists, cyclists, bus passengers, and transport workers traveling paved and unpaved roadways globally. Job: Passively and safely record road hazards during regular journeys anywhere in the world without manual taps, distractions, or privacy loss.
- **Data Consumers (Civic & Commercial):** Municipal highway and urban authorities, civic technology groups, civil engineering researchers, and global logistics/fleet managers (couriers, ride-hailing services, freight dispatchers). Job: Inspect verified, ground-truth surface hazard data to prioritize road maintenance, optimize routing, and minimize vehicle suspension/cargo damage.

## Product Purpose

Hodos exists to crowdsource global road surface hazard mapping without requiring active human reporting. It makes the invisible degradation of public road infrastructure visible, actionable, and accountable across any road in the world ("The road maps itself"). Success means a high-density, corroborated worldwide map of potholes, rough sections, and speed humps built completely passively from ambient smartphone sensor readings, governed by a sustainable dual-license model.

## Positioning

Unlike manual crowdsourcing apps (e.g., Waze or civic complaint hotlines) that require drivers to dangerously look at screens and tap buttons while driving, Hodos operates 100% autonomously in the background anywhere on earth using on-device inertial sensors (accelerometer and gyroscope) coupled with adaptive Median Absolute Deviation (MAD) noise floor tracking to distinguish vehicle vibrations from actual road defects. Unlike closed commercial fleet telematics, Hodos combines free open-source software (MIT) with a community-protected open dataset (CC BY-NC-SA 4.0 for civic/academic use, paid commercial license for enterprise logistics).

## Operating Context

- **Android App:** Runs in the background on smartphones positioned in pockets, vehicle cup holders, or dashboard mounts. Leverages Android Activity Recognition to wake sensor polling exclusively during vehicular movement. Operates under low power and intermittent network connectivity with local SQLite observation queues and offline-cached Wi-Fi vector tiles (20 km radius).
- **Web Platform:** Desktop and mobile browser interface (`https://hodos.devilabs.dev/map` and home showcase). Renders a high-contrast neutral Carto Positron basemap with high-contrast defect points, search drawer, coordinate inspection, GeoJSON/GPX downloads, and live Appwrite backend sync.

## Capabilities and Constraints

- **Confirmed Capabilities:**
  - Android sensor pipeline: Butterworth low-pass filter, jerk vector thresholding, dynamic MAD noise-floor tracking.
  - Privacy geofencing: First and last 250 meters of every trip are automatically excised on-device; raw accelerometer traces never leave device RAM.
  - Web explorer: High-contrast MapLibre GL map, instant search and coordinate fly-to, live synchronization with Appwrite backend, GeoJSON and GPX exports, interactive sensor oscilloscope simulator.
  - Corroboration engine: Multi-trip corroboration and spatial clustering (DBSCAN) in Appwrite aggregation functions to distinguish transient bumps from durable physical road defects.
- **Durable Constraints:**
  - ZERO EMOJIS: Never use green/yellow/red circle emojis or decorative emojis in UI code, maps, badges, or copy. Use SVG glyphs and neutral CSS tokens.
  - Zero Intrusive Haptics: The smartphone must NEVER vibrate or play sound when hitting road bumps.
  - Data Integrity: Only real backend data; zero mock corridors, artificial road lines, or fabricated defect points.
  - Dual Licensing: Software code is MIT; crowdsourced telemetry datasets are CC BY-NC-SA 4.0, requiring paid enterprise licensing for commercial fleet routing or logistics.

## Brand Commitments

- **Name:** Hodos ("The road maps itself").
- **Identity Assets:** The master Hodos artwork (`brand/icon.svg`, `apps/web/public/hodos-icon.png`) is the sole master brandmark and favicon source.
- **Voice:** Pragmatic, technical, civic, restrained. No marketing hype, no ads, no trackers.

## Evidence on Hand

- 438 real road hazard observations committed in `apps/web/public/data/hazards.json` and live-synced from Appwrite.
- Live web deployment serving global users at `https://hodos.devilabs.dev/map`.
- Production Android APK release at `https://github.com/DrSkyle/hodos/releases` ready for global device deployment.
- Transactional outreach infrastructure configured via Resend (`hodos@devilabs.dev`).

## Product Principles

1. **Passive Autonomy:** Zero manual touches while traveling; the application gathers telemetry silently and safely.
2. **Privacy by Construction:** No raw GPS traces; endpoints trimmed by 250m; pseudonymous installation IDs.
3. **Ground-Truth Fidelity:** Strict presentation of real, corroborated observations; no artificial corridor lines or mock hazards.
4. **Radical Restraint:** High-contrast, clean visual design with zero decorative emojis or visual noise.
5. **Data Sovereignty:** Free open-source software (MIT) paired with community-protected data licensing (CC BY-NC-SA 4.0) to prevent unilateral corporate extraction.

## Accessibility & Inclusion

- High-contrast basemap ensuring defects remain distinguishable by geometric shape, icon, and label, not color alone.
- Accessible keyboard navigation and controls for the web map.

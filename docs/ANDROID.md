# Hodos on Android

Android is the **primary application**. The public domain is now a landing page,
not a second app that has to stay in sync with native UI.

## Stack

- Kotlin + Jetpack Compose + Material 3 for screens and controls
- MapLibre Native Android for the map (OpenGL renderer for broad device support)
- Existing Java `MotionDetector` + `HodosService` for low-level motion analysis
- OkHttp for Appwrite TablesDB and event reporting
- SharedPreferences for service flags, device identifiers, offline map cache and local trips

The original browser UI code still exists under `apps/web/src/main.ts` during
migration, but the domain now loads `apps/web/src/landing.ts`. Do not package the
browser UI inside the APK.

## Build

Requires JDK 17 and Android SDK platform 35:

```bash
cd apps/web/android
./gradlew :app:assembleDebug
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`.

## Before a stable public release

1. Test the full permission sequence on Android 10, 11, 13, 14 and 15.
   Android 11+ requires granting "Allow all the time" through settings.
2. Confirm motion detection runs when the display is off, vehicle activity
   starts and ends, and the foreground notification is visible.
3. Confirm the Appwrite event-append and aggregation APIs work on device.
4. Test airplane mode and unreliable networks; the map caches last good
   hazard rows, but **observations currently need a network connection**.
5. Validate map markers, map attribution, touchscreen targets, TalkBack,
   reduced-motion preferences and battery use on actual devices.
6. **Migration gate:** the existing Capacitor release stored recovery identities
   and trip tallies in WebView localStorage. The native app does not yet import
   that data, nor does it restore cloud profiles through the recovery code.
   Do not advertise this as a seamless upgrade until migration is implemented
   and verified. Advise existing testers to export/copy their recovery code.
7. **Signing gate:** CI currently produces a debug-signed APK for internal
   testing. Android requires the same signing key for in-place updates. Create
   and securely retain a release keystore and configure a separately signed
   release workflow before offering a stable downloadable APK.

## Data architecture

Clients **append** observations to `events`; the Appwrite
`hodos-aggregate` function is the only process intended to write `hazards`.
The native service requests aggregation after background trips. Raw sensor
samples stay on-device. Public hazards are cached for offline browsing.

## Future milestones

- Encrypted durable upload queue for background events when offline
- Migrate the existing account and recovery-code identity and profile syncing
- User-initiated location follow mode and accessible marker filtering
- Benchmark detector parity, battery efficiency, repair event lifecycle
- Stable release signing, automatic update path and real device QA

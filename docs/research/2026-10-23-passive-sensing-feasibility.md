# Hodos — Feasibility of passive road-hazard sensing from a mobile web app (PWA)

Research note, 2026-10-23. Question: can a phone that "just rides in a vehicle or pocket" detect road
defects from motion sensors + GPS and upload geotagged events, entirely as a browser-based PWA?

**Verdict in one line:** foreground sensing + detection is genuinely feasible on both iOS and Android;
*passive, screen-off, app-backgrounded* collection is **impossible in a browser today** and forces an
entirely different product shape (mount + open app + screen on) or a native/embedded-native wrapper.

---

## 1. Sensor + GPS access from a web app

### Accelerometer / gyroscope
- `window.addEventListener('devicemotion', …)` → `DeviceMotionEvent` with `acceleration`,
  `accelerationIncludingGravity` (both m/s²), `rotationRate` (deg/s), `interval` (ms).
  ([MDN DeviceMotionEvent](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent))
- **HTTPS is mandatory.** The interfaces are marked `[SecureContext]` in the spec; MDN flags
  "Secure context" on the interface and the `devicemotion` event. `localhost` is treated as secure for dev.
  ([W3C Device Orientation and Motion §6.3.3](https://w3c.github.io/deviceorientation/))
- **Permissions Policy gating:** the events are only dispatched if the document "is allowed to use"
  the policy-controlled features `accelerometer` and `gyroscope` (default allowlist `self`). Cross-origin
  iframes need `allow="accelerometer; gyroscope"`. This applies even for top-level frames — a header
  policy can silently kill the stream. (same spec, §4 + §6.3.3)
- **iOS Safari 13+ — explicit opt-in, triggerable only from a user gesture.**
  `DeviceMotionEvent.requestPermission()` must be called with *transient activation*; otherwise the spec
  requires the promise to reject with `NotAllowedError`. Safari caches the answer per site (granted/denied
  survives reloads; to re-prompt you must delete website data), and there is a master
  *Settings → Safari → Motion & Orientation Access* toggle. Net effect: **"zero user interaction" is broken
  at least once per site**, and there is no way to query or re-trigger the prompt programmatically.
  ([MDN requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static),
  [SO 56514116](https://stackoverflow.com/questions/56514116/how-do-i-get-deviceorientationevent-and-devicemotionevent-to-work-on-safari),
  [Apple Forums 128376](https://developer.apple.com/forums/thread/128376))
- **Android Chrome — no user-visible prompt** for `devicemotion`; it is only Permissions-Policy-gated.
  (Chrome never shipped the iOS-style motion prompt; see the spec's note on `requestPermission` implementations
  being "at risk" for low pass rates.)
- Wearables/laptops: many devices have no gyroscope → `rotationRate` and `acceleration` may be `null`; the
  spec explicitly allows firing with `acceleration`/`accelerationIncludingGravity`/`rotationRate` all null.
- Firefox/Chrome differ on coordinate conventions (MDN warning) — don't hard-code handedness assumptions.
- **Generic Sensor API** (`new Accelerometer({frequency:60})`, `LinearAccelerationSensor`) is Chromium-only
  (no Safari), also HTTPS + `allow="accelerometer"` gated, and Chromium explicitly documents that
  *"sensor readings are only accessible by a visible web page"*. It does **not** rescue background use; it
  is useful mainly because you can request a specific frequency.
  ([Chrome: Sensors for the web](https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor))

### GPS
- `navigator.geolocation.watchPosition()` / `getCurrentPosition()`; **secure context only**; explicit prompt;
  `Permissions-Policy: geolocation` (default `self`). Permission lifetime is UA-defined (session to permanent).
  ([MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API))
- Practical accuracy: ~3–5 m outdoors (MIT's P2 measured 3.3 m standard deviation against a known metal bar;
  ~5 m median typical). That is **larger than a pothole**, so single-event localisation is not trustworthy —
  corroboration across passes is mandatory. ([Pothole Patrol, §3.2](https://people.csail.mit.edu/hari/papers/p102.pdf))
- GPS fixes are also not driven when the page is hidden; a browser cannot ask the OS for
  "significant location change" wake-ups (that is a native `CoreLocation` / Android Fused Location concept).

---

## 2. Background execution — what is actually blocked

**The hard blocker is normative, not policy lore.** The spec requires implementations to
*"fire events only when a navigable's active document's visibility state is `visible`"*, and the firing
algorithm returns immediately if `document.visibilityState !== "visible"`. A hidden document therefore
receives **no** `devicemotion` and **no** `deviceorientation` events, by design (anti-fingerprinting).
([W3C §6.1 and §6.3.3 / §7](https://w3c.github.io/deviceorientation/))

| Situation | iOS Safari | Android Chrome |
|---|---|---|
| Tab visible, screen on | sensor + GPS stream live | sensor + GPS stream live |
| Screen off / locked | document becomes `hidden`; JS suspended; stream stops; page may be killed | document `hidden`; stream stops |
| Switched to another app | Web process suspended; stream stops | page hidden; stream stops |
| Hidden > 5 min, chained timers | n/a (already suspended) | "intensive throttling": timers run once per **minute** |
| Hidden/page frozen | process suspended (WebKit bug 211018 documents freeze/resume on visibility change) | page may be **frozen** (timers + fetch callbacks stop) then **discarded** (`document.wasDiscarded` on reload) |

Sources: [Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api),
[Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/),
[WebKit bug 211018](https://bugs.webkit.org/show_bug.cgi?id=211018),
[MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).

### Workarounds and their limits
- **Screen Wake Lock** (`navigator.wakeLock.request('screen')`) keeps the screen on — but *only while the
  document is active/visible*: previously acquired locks are auto-released when the document becomes
  inactive, and you must re-acquire on `visibilitychange`. It is a screen-brightness control, **not** a
  background-execution grant. Chrome 84+, Safari 16.4+, Baseline since March 2025.
  Caveat: broken in iOS **Home Screen web apps** from 16.4 until **18.4** (fixed 18.4).
  ([MDN Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API),
  [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545))
- **Installed PWA changes nothing about sensing.** On both platforms a Home-Screen web app is still a web
  process that is hidden/suspended when you leave it. (WebKit bug 211018 is specifically about Home Screen
  web apps freezing after backgrounding.)
- **Audio playback / WebRTC** keep Chrome timers out of the "silent" bucket so they are only minimally
  throttled — but this affects *timers*, not sensor delivery, which is still visibility-gated.
- **Anything resembling a background task does not exist on the web**: no scheduled wake-up, no significant-motion
  trigger, no foreground service, no Doze exemption, no "collect for 8 h then upload" primitive.
- Net design consequence: the only browser configuration that senses continuously is
  **app in foreground + screen on + wake lock held**. A phone "in a pocket, screen off" is a dead end.

---

## 3. Sample rates and `accelerationIncludingGravity`

- The spec deliberately defines **no** sampling rate: `interval` is *implementation-defined*, constant for the
  session, and there is an open W3C privacy issue arguing the rate *should* be capped at something like
  **25–60 Hz** (high rates enable gyrophone-style audio eavesdropping).
  ([w3c/deviceorientation#87](https://github.com/w3c/deviceorientation/issues/87))
- Measured/observed ballpark: **~30–60 Hz typical on modern phones in-browser**; iOS Safari tends to sit near
  ~60 Hz (Apple's device-motion update interval is capped by hardware and Apple says to trust timestamps, not
  the configured interval); Chromium clamps accelerometer-class sensor requests at **60 Hz**
  (10 Hz for magnetometer-class). Treat any number as unguaranteed and read your own timestamps.
  ([Apple: deviceMotionUpdateInterval](https://developer.apple.com/documentation/coremotion/cmmotionmanager/devicemotionupdateinterval),
  [MDN interval](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/interval))
- Hardware variance is real: Mednis et al. measured app-level rates of **26 / 47 / 52 / 98 Hz** across four
  Android phones on the same track ([Mednis 2011, Table I](http://strazdins.lv/papers/mednis2011androidpotholes.pdf)).
  A 2022 iOS CNN study set 100 Hz and actually achieved 70–100 Hz
  ([Pandey et al., §5.1](https://pure.coventry.ac.uk/ws/files/52698419/Critical_Infrastrature_CNN.pdf)).
- **Precision is clipped to 0.1 m/s²** for all acceleration components and 0.1 deg/s for rotation rate
  (spec requirement, anti-fingerprinting). Pothole impulses of ~0.5–3 g (≈5–30 m/s²) survive that fine.
- **`accelerationIncludingGravity` is the reliable field** — it is the raw accelerometer (or a best-effort
  fallback) and is what every research implementation uses. `acceleration` (gravity removed) *may be `null`*
  when the platform cannot produce linear acceleration, so never depend on it; do your own gravity subtraction /
  high-pass filtering. ([MDN DeviceMotionEvent.acceleration](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent))
- Axis mapping is orientation-dependent: x = right, y = top of screen, z = out of screen. A phone mounted
  upright on the windscreen has the vertical impulse on **y** (that is what the Coventry CNN paper used); a
  phone lying flat on a seat has it on **z**. Hodos must estimate the gravity vector (low-pass of
  `accelerationIncludingGravity`) and rotate into a vehicle frame, or restrict mount orientations.

---

## 4. Accelerometer pothole detection: the standard approach

### Pipeline that the literature converges on
1. **Window** the stream (P2: 256 samples; Mednis: 20-sample sliding window for STDEV).
2. **Speed gate** — discard windows where the vehicle is stationary or very slow (rejects door slams,
   curb ramps; also the reason slow junction potholes get missed).
3. **High-pass / band-pass** the vertical (and lateral) axis to remove gravity, braking, cornering and slow
   sensor-orientation drift. P2 uses a high-pass stage; the Jyväskylä work uses a **0.5–6.0 Hz band-pass**.
4. **Vertical peak threshold** (`z-peak`): Mednis' tunings on real drives —
   - `Z-THRESH` at **0.4 g** → 78% true-positive, 76% of detections were true hits;
   - `Z-DIFF` (difference of consecutive samples) at **0.2 g** → **92% TPR**, 77% true hits (best simple rule);
   - `STDEV(Z)`, 20-sample window, **0.2 g** → 81% TPR / 76%;
   - `G-ZERO` (all three axes near 0 g = free-fall) at **0.8 g** → 73% TPR.
   Nericell tuned `z-peak` to **1.75 g**, reaching **3–8% false positives at high speed**, and used a
   `z-sus` sustained-dip detector below **25 km/h** where `z-peak` behaves badly.
5. **xz-ratio**: peak lateral x within `w = 32` samples of the z-peak must be ≥ `t_x ×` z-peak, to reject
   features that hit both wheels equally (railway crossings, expansion joints, speed bumps). `t_x = 1.5`
   conservatively, `2.5` once the speed filter is in place.
6. **speed-vs-z ratio**: require z-peak ≥ `t_s × speed` (`t_s = 5`) because impulse scales with speed.
7. **Spatial corroboration / clustering**: require ≥ **k = 4 independent passes** over the same spot
   (within ~δ) before reporting. This is the crowd-sourcing step that kills one-off in-vehicle events.
8. **Blacklist** known features from GIS (rail crossings, speed bumps, expansion joints).

Sources: [Pothole Patrol (Eriksson et al., MobiSys'08)](https://people.csail.mit.edu/hari/papers/p102.pdf),
[Nericell (Mohan et al., SenSys'08)](https://dl.acm.org/doi/10.1145/1460412.1460444),
[Mednis et al. 2011](http://strazdins.lv/papers/mednis2011androidpotholes.pdf).

### Reported accuracy (be sceptical — these are per-vehicle, mounted-phone datasets)
- **P2**: < **0.2%** of good-road windows flagged as potholes; on hand-labelled test data **92.4%** of reported
  detections were actual potholes (up from 88.9%); of the 48 highest-confidence clustered detections, 39 were
  potholes + 3 sunk manholes, 4 rail/expansion joints, 2 undetermined → "**over 90%** contain road anomalies
  in need of repair".
- **Mednis**: TPR up to **92%**, but only **77%** of detections were within 15 m of a known defect.
- **Nericell**: **3–8%** false positives at high speed with a tuned 1.75 g threshold.
- **ML/DL**: 1-D CNN on 100 Hz accelerometer → **93.7–96.3%** accuracy, precision 98%, recall 84%, F1 91%
  (Coventry/iOS study); random forest 95.7%, SVM 94.8%, logistic regression 95.2% (Chao et al. 2020);
  a deep-learning speed-bump detector reports **98.9%** accuracy for bump detection.
- Crowdsourced with arbitrary phones, mounts and speeds you should expect much worse than all of the above;
  the corroboration-by-repetition step (k ≥ 4) is what makes the system usable, not the single-trip classifier.

### Dominant false-positive sources
- **In-vehicle events** (P2's explicit uncontrolled-error list): door slams, passengers drumming the
  dashboard or opening the glove-box, hard braking, sudden swerves, rapid acceleration.
- **Road features that are not defects**: railroad crossings, bridge expansion joints, crosswalk paint/raised
  dots, manhole covers (flush vs sunk), **speed bumps** — the single hardest confusion for a pothole detector.
- **Mounting/orientation**: P2 showed a loosely attached sensor produces "unpredictable results" and had to be
  firmly fixed to the dash; arbitrary pocket placement measurably lowers detection rates.
- **Speed dependence**: identical potholes give different amplitudes at different speeds, so raw thresholds
  misfire unless normalised.
- **GPS error** (3–5 m) → mis-localisation and false clustering; also, drivers avoid potholes, biasing the
  sample.
- **False negatives** worth designing around: slow-speed manoeuvres (turning) under-threshold; tiny
  transitions on smooth multi-lane roads; 100 Hz sampling cannot resolve a pothole at motorway speed
  (~26 m travelled per second).

---

## 5. Offline buffering + sync in a PWA

- **Works on both platforms:** service worker + Cache API for the app shell; **IndexedDB** for the sensor/event
  buffer. This is the only durable, script-writable, large-capacity store available.
- **Background Sync (`SyncManager`) is Chromium-only** (Chrome/Edge/Opera); Firefox and Safari do not implement
  it. On iOS there is **no** "wake me when the network returns" primitive — flushing must be driven by
  foreground events (`online`, app start, `visibilitychange → visible`).
  ([MDN Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API))
- **Periodic Background Sync** is installed-PWA-only on Chrome, permission `periodic-background-sync`, fires
  only if the site-engagement score > 0 and only on previously used networks, with browser-controlled timing
  and a long floor (commonly quoted at ~12 h). It can drain your queue; it **cannot** collect sensors.
  ([Chrome periodic background sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync),
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API))
- **iOS Web Push** (16.4+, installed web apps only, permission behind a user gesture) can wake a service
  worker — which has no DOM and therefore **cannot read `devicemotion`**; useful only to trigger an upload.
  ([WebKit: Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/))
- **iOS 7-day eviction:** ITP deletes all script-writable storage (IndexedDB, Cache, localStorage) for
  non-installed origins after 7 days without interaction. Home-Screen web apps keep a separate counter and are
  exempt — another reason to require "Add to Home Screen".
  ([WebKit Tracking Prevention](https://webkit.org/tracking-prevention/))
- **Design:** append-only event log in IndexedDB → flush on start/`online`/foreground with exponential backoff
  and idempotent client-generated event IDs; call `navigator.storage.persist()` and handle refusal; upload
  **aggregated events, not 100 Hz raw traces** (raw is ≈1.2 kB/s ≈ 4.3 MB/h/axis-pair) to protect battery and
  data.

---

## 6. What a builder must design around

**Impossible in a browser today (would force a native app or a native wrapper):**
1. Any sensor or GPS sampling while the screen is off or the app is backgrounded (spec-mandated visibility gate).
2. Auto-start on driving / "significant motion" triggering; any scheduled background wake-up.
3. Reading motion sensors from a service worker or any hidden context.
4. Flushing data in the background on iOS (no Background Sync at all).
5. Permission-free first run on iOS Safari (a tap is required before the first sample).
6. Any OS-level battery/Doze exemption or long-running background service.

**What actually works (Hodos v1 shape):**
- Foreground-only "drive session": user mounts the phone, opens the app, taps Start once; app holds a Screen
  Wake Lock, keeps the page visible, records `devicemotion` + `watchPosition`, detects events on-device, buffers
  in IndexedDB, uploads when online.
- Auto-stop the session after N seconds of no motion, and use the same sensor stream for a "still in a
  vehicle?" heuristic so the user isn't asked to stop manually.
- Normalise for mount orientation (gravity vector → vehicle frame), speed-normalise thresholds, corroborate by
  repeated passes before publishing a hazard, blacklist known road features, and never trust `acceleration`.
- If "phone in pocket, screen off, all day, zero interaction" is a product requirement, that is a **native
  app** requirement (iOS background location + Core Motion; Android foreground service with
  `location` type + activity recognition), optionally wrapped with Capacitor so the web UI is reused.

# Hodos

**Passive, crowdsourced road-hazard mapping for your neighborhood.**

Hodos turns the phones already travelling your streets into a road-condition
sensor. Mount a phone, tap start, drive. The app reads the road from the motion
sensors, works out where the potholes, speed bumps and rough patches are, and
adds them to a shared map. Nobody files a report.

- **Web app:** https://hodos.devilabs.dev
- **Android app:** built by CI, attached to the [latest release](../../releases/latest)
- **Backend:** Appwrite (TablesDB), project `elpis`, database `hodos`

---

## Why

Most road-condition data is either surveyed by fleets (expensive) or collected
by hand (biased — people report what is near home, never the arterial they
drive past). Hodos sits in the middle: the sensors already exist, in everyone's
pocket, and the detection is passive.

## How it works

```
 phone sensors            on-device                 shared
 ─────────────            ─────────                 ──────
 accelerometer  ──►  impact detection  ──►  event log (write-only)
 GPS            ──►  (core/detect)           hazard map (public)
                     clustering + scoring
                     (core/cluster)
```

1. **Sample.** While a trip is recording, `DeviceMotionEvent` and the
   Geolocation API stream accelerometer samples and position fixes.
2. **Detect.** On the phone, `@hodos/core` estimates and removes gravity, then
   band-passes the vertical residual to 0.5–6 Hz — the band road impacts live
   in. Engine vibration and body shake sit above it; cornering, braking and
   gradient sit below. Detection thresholds ride a **rolling, spike-resistant
   noise floor**, so a quiet car on a smooth road and a noisy car on a rough one
   both work, and regular footfalls raise the floor enough to suppress
   themselves.
3. **Attribute.** Each candidate event is characterised — peak, rise time,
   pulse width, lobe count, jerk, and how much of it was lateral rather than
   vertical — and **classified** as a pothole, a speed bump, or rough pavement.
   A kerb strike or a swerve is mostly lateral and is rejected outright. An
   event that does not look like any defect is dropped.
4. **Grade.** Severity is read from the **speed-normalised** magnitude, so a
   shallow pothole taken at 60 km/h is not automatically "severe". Each impact
   carries its own confidence, derived from the classifier's margin, the signal
   above the noise floor, and the GPS accuracy at that moment.
5. **Corroborate.** Impacts within a merge distance collapse into one
   *Hazard*. A hazard is only published to the public map once it has enough
   independent passes from distinct devices (default: 3 passes, 2 devices).
   Confidence fades with age.
6. **Share.** Detected impacts are appended to a write-only `events` log;
   merged hazards are written to the public `hazards` table.

## A map with consequences

A hazard is not a pin that sits there forever. Tap one and you get its record —
how many passes confirm it, how many phones, when it was first and last seen,
how long it has been visible. Two actions change it:

- **Still there** re-confirms it, another pass, seen now, confidence up.
- **Fixed now** reports it repaired; once enough people agree the hazard turns
  green on the map.

That loop is what stops the map being a snapshot: it records the road getting
worse and getting better.

## Yours

Open it and the app finds your street, names the area, and starts a tally:
trips taken, impacts felt, distance travelled, hazards confirmed. No sign-up
screen, no email, no password prompt — but it is unmistakably yours, and it
survives a new phone.

That works because the app quietly creates a real identity on first run and
hands you a **recovery code**. The code *is* the account: paste it on another
device and your street and tally come back. Keep it, and nothing is lost; lose
it, and you have lost what you were told you would lose. The tally itself lives
in a row only your identity can read. See
[ADR-0006](docs/adr/0006-anonymous-identity-and-recovery-code.md).

## The data

Everything the phones find is structured and visible. The **Data** tab lists
every hazard with the evidence behind it — passes, distinct phones, days
observed, confidence, silent passes, repair reports — and exports the whole set
as **CSV** or **JSON** (the JSON is self-describing). Field-by-field meanings and
the privacy treatment of each one are in [`docs/DATA.md`](docs/DATA.md).

## Repository layout

```
packages/core/     domain logic: impact detection, clustering, confidence (tested)
apps/web/          the app: capture session, MapLibre map, report export, PWA
apps/web/android/  Capacitor Android project (built to an APK in CI)
appwrite/          backend provisioning script and configuration
docs/              spec, privacy policy, ADRs, submission material
```

## Quick start

```bash
pnpm install
pnpm --filter @hodos/core test      # domain logic, 15 tests
pnpm --filter @hodos/web dev        # http://localhost:5173
```

The web app talks to the live Appwrite backend by default. Point it elsewhere
with environment variables:

```bash
VITE_APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1 \
VITE_APPWRITE_PROJECT_ID=<project-id> \
pnpm --filter @hodos/web dev
```

### Backend

```bash
cd appwrite
appwrite login                  # or link an existing project
./setup.sh                      # creates database, tables, indexes, permissions
```

### Android

```bash
pnpm --filter @hodos/web build
pnpm --filter @hodos/web exec cap sync android
cd apps/web/android && ./gradlew assembleDebug
```

CI does this automatically on every push to `main` and publishes the APK to the
latest release.

## Privacy

No accounts. A random device identifier that rotates daily. Raw sensor traces
never leave the phone — only the detected impact, coarsened to the road, is
sent. The observation log is write-only. See [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Limitations, stated plainly

- **Browser background sensing is impossible.** The W3C spec only fires motion
  and location events while the page is visible, so recording needs the screen
  on. This is written up in [`docs/research/`](docs/research) and
  [ADR-0001](docs/adr/0001-foreground-recording-session.md).
- Hazard merging is currently done by the client. That is simple and works, but
  it is gameable and can drop counts under concurrency; the intended upgrade is
  server-side aggregation over the `events` log. See
  [ADR-0003](docs/adr/0003-appwrite-datastore-and-client-merge.md).
- The detector is tuned from published accelerometer research, not from a
  large local dataset. Thresholds are configurable in
  `packages/core/src/detect.ts`.

## Accessibility and use of AI

Hodos is built to run on any phone that has a browser, and installs as an app
without an app store. AI coding assistants were used during development and
that is disclosed in the submission, as the event rules require.

## Licence

MIT.

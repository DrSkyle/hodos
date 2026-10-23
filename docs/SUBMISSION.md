# Hodos — Neighborhood Hacks 2026 submission

Draft submission copy. Anything in `[square brackets]` is a fact only you can
supply — your own observation, in your own words.

## Project name

**Hodos** — from the ancient Greek *hodos*, "the road".

## Elevator pitch

Hodos turns the phones already travelling your streets into a road-condition
sensor: drive with it running and it maps the potholes, speed bumps and rough
patches for everyone, without you filing a single report.

## Full description

### What is the specific problem, and how do you know it's real?

Road defects are a small, constant tax on everyone who uses a street. They cost
money in repairs, they are a real safety hazard for cyclists and motorcyclists,
and they are invisible to anyone who does not happen to drive that road.

The reason they stay unrepaired is not that nobody notices. It is that nobody
*records*. The two existing ways of mapping road quality both fail:

- **Complaint channels** (311, SeeClickFix, Fill That Hole) only capture what
  people bother to report. Reporting is biased toward where people live and
  complain — Boston's own passive-sensor pilot found that 311 almost never
  reports on high-speed arterial roads, because nobody stops to file a form
  there.
- **Professional survey fleets** work, but they are expensive, and they are
  run by contractors on a schedule, not by the neighbourhood.

Boston tried the middle path in 2011: **Street Bump**, an iPhone app that read
the accelerometer and auto-filed road defects if three people hit the same bump.
It ended in 2014, hamstrung by two problems we designed around — it was
iPhone-only, so its data had a well-known sampling bias (the canonical "signal
problem" example), and its single-purpose app ruled out everyone who would not
install it.

That is the gap. The sensors already exist, in everyone's pocket, and nobody has
shipped a version that reaches them without an install.

**What I observed locally:** [YOUR OBSERVATION — name the specific road, junction
or route near you. What is wrong with it, how long has it been like that, and how
did you or someone you know get affected? For example: "On the way to school,
the stretch of X road just past Y has a sunken drain cover and two potholes that
have been there since [month]. I ride/walk/drive it daily. The school bus hits
them every morning." Add anyone you talked to — a neighbour, a cyclist, a
delivery rider, someone at the ward office — and what they said.]

### What the solution does and how it works

Hodos is a road-condition sensor built from ordinary phones.

1. You mount a phone, open Hodos and tap **Start trip**.
2. While you travel, the app reads the accelerometer and GPS. On the phone it
   removes gravity, isolates the vertical motion of the vehicle, and picks out
   the sharp impacts that mean a pothole, a speed bump or a rough patch.
3. Each impact is graded by severity and located to the road.
4. Impacts at the same spot, seen on separate trips by separate devices, are
   merged. **A hazard only appears on the public map once at least three passes
   from at least two different devices agree on it** — so the map is
   trustworthy, not just a dump of everyone's noise.
5. The public map shows confirmed hazards. Any resident can export a
   data-backed **road report** for a stretch of road — the artefact you take to
   whoever is responsible for fixing it.

The whole point is that the *collection* is passive. You do not report
anything. You drive, and the map fills in.

### What it was built with

- **TypeScript** throughout, as a pnpm workspace.
- **`@hodos/core`** — the domain logic (impact detection, clustering,
  confidence), pure and unit-tested with Vitest. No framework, no platform, so
  the same code runs on the phone and in tests.
- **Vite** and **MapLibre GL** for the web app, which installs as a PWA.
- **Capacitor** for the Android build, distributed as an APK from GitHub
  Releases.
- **Appwrite** (TablesDB) for the backend: a write-only `events` log and a
  public `hazards` table, provisioned by a script in `appwrite/setup.sh`.
- **Cloudflare Pages** for hosting.
- **GitHub Actions** for CI: tests on every push, an APK build attached to a
  release, and a deploy of the web app.

AI coding assistants were used during development, and that is disclosed here
as the event rules require.

### Challenges we ran into

- **The browser cannot sense in the background.** This was the biggest one. We
  designed Hodos around "phone in a pocket, screen off, zero interaction" and
  then found that the W3C spec only delivers motion and location events while
  the page is *visible*. It is not a browser bug; it is the spec. We documented
  the limits, reshaped recording into an explicit trip, and shipped a Capacitor
  Android build as the path to real background sensing.
- **Telling a pothole from a speed bump, from a manhole cover, from a door
  slam.** The published detection work is clear that raw accelerometer peaks
  are full of false positives. We leaned on a speed gate, a debounce window, a
  GPS-accuracy gate, and corroboration across devices — and we kept every
  threshold configurable rather than pretending one number is right.
- **Trust without identity.** Asking people to sign in before they can
  contribute would have killed the whole idea. That forced the corroboration
  model, and it forced the privacy design: rotate the identifier, keep the
  traces on the phone, make the log write-only.

### What we would do next

- Replace the client-side hazard merge with server-side aggregation over the
  `events` log, so the map cannot be gamed.
- Snap hazards to road centrelines, so a point sits on the carriageway rather
  than beside it.
- A native foreground service on Android, for genuinely background sensing.
- Tune the detector against real local data, and publish our false-positive and
  coverage numbers honestly.
- Approach the local ward office with the first exported report.

## Demo video (2–6 minutes)

Suggested shot list:

1. The problem, on the actual road — film the potholes you named above, from a
   bike or a car, with the phone in frame.
2. The gap — one line on why 311 and survey fleets both miss it.
3. Hodos running — mount the phone, tap start, drive the route, and show
   impacts appearing live as the purple dots.
4. End the trip — show the summary, then switch to the map and show the
   hazards. Explain the three-pass corroboration rule on screen.
5. Export the report and show the table.
6. Close on the honest limitation and the next step.

## Links

- **Code:** https://github.com/DrSkyle/hodos
- **Live app:** https://hodos.devilabs.dev
- **Android APK:** the `apk-latest` release on the repository

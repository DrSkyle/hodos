# Detection engine: what changed

This is the before/after note for the detector upgrade. "Before" is the pipeline
described by the previous README; "after" is the code in `packages/core/src` and
`apps/web/android/app/src/main/java/org/hodos/app`, verified by
`engine.test.ts`, the rewritten repo tests, and the shared parity fixtures.

## The bug that started it

A user walked about 20 m from their room to a toilet and Hodos recorded a speed
bump.

Root cause: `resolveMode()` returned `"vehicle"` whenever there were **no usable
speed values**. Walking indoors produces no GPS speed at all, so the session was
treated as driving, the vehicle thresholds applied, and 4 s of pocket vibration
cleared them. "No speed evidence" was silently treated as "vehicle evidence".

## before → after, per case

| Case | Before | After |
| --- | --- | --- |
| Walk to the bathroom, phone in pocket, no GPS | speed bump, because no speed ⇒ vehicle | **no impact, no journey**; state `walking` |
| Standing still, phone being handled | could start a journey on sustained vibration | **nothing**; state `in_hand` |
| Bicycle at 20 km/h over a rut | pothole or rough road at full vehicle severity | **`rough_pavement`, severity 1, confidence ×0.75**, mode `cycling` |
| Motorcycle at 30 km/h over a speed bump | speed bump (unchanged in kind) | **speed_bump, severity 2**, unchanged |
| Bus with constant diesel shudder | occasional false bumps when the shudder eased | **no false positives**: per-journey calibration pins the floor after 20 s of confirmed motion |
| Tunnel: no GPS, GPS returns | impacts could be placed on the stale pre-tunnel fix | **nothing fabricated**; placement is null inside any gap > 5 s and nothing is backfilled |
| Pothole at 15 km/h | dropped by a 12 km/h vehicle speed gate | **detected**; the vehicle gate is 5 km/h, and vehicle state is itself the gate |
| Same defect on three passes | server clustering only | on-device `RepeatLedger` sets `repeats` and raises confidence by 0.08/pass, capped at 0.2 |
| Mounted vs in hand over the same road | identical treatment | **mounted produces the impact**, in_hand produces nothing |
| GPS says 36 km/h but the phone never moved | counted as a vehicle | **`unknown`**: reported speed and displacement disagree ⇒ `gpsConflict` |

## Constants that changed

| Constant | Before | After |
| --- | --- | --- |
| vehicle `noiseK` | 3.0 | **4.0** (raised after one bus false positive in the sweep) |
| vehicle `minSpeedKph` | 12 | **5** |
| `maxLateralRatio` | 0.8 (hard reject) | **1.4** hard, with a **soft penalty from 0.5** |
| `PARTNER…` n/a | — | — |
| `MAX_FIX_ACCURACY_M` in mode resolution | 50 | 50, but fixes must also be finite and in range |

New constants (all in `DEFAULT_*` objects): `calibrationFloorShare` 0.8,
`learnMs` 20000, `gapResetMs` 250, `cycling` mode (floor 1.3, K 3.5, 5–55 km/h),
`cyclingMaxSeverity` 1, `cyclingConfidenceScale` 0.75, `softLateralRatio` 0.5,
`lateralPenalty` 0.3, `yawRejectDps` 35, `handlingGyroDps` 120,
`minRoadBandRatio` 0.35, and the whole `MotionStateOptions` set.

## Public-contract additions (additive only)

- `TravelMode` gains `"cycling"`.
- New `MotionState = "still" | "walking" | "cycling" | "in_hand" | "vehicle" | "unknown"`.
- `Impact.motionState?: MotionState` and `Impact.repeats?: number`.
- `ImpactFeatures` gains optional `roadBandRatio`, `gyroPeakDps`, `yawPeakDps`.
- `resolveMode()` now returns `TravelMode | null` — **no speed is no longer
  "vehicle"**. No repo caller depended on the old default.
- Java: `Sample` gains optional gyro; `Impact` gains `motionState`/`repeats`;
  `Features` gains the three optional fields; `MovementDetector.Decision` gains
  `state`; `resolveMode` returns `String` or `null`.

Nothing was removed. Old wire rows without any of the new fields still validate.

## Tests

- `packages/core/src/engine.test.ts` — 45 tests, all 9 readme cases plus extras.
- `packages/core/src/fixtures.gen.test.ts` — regenerates 17 scenarios in memory
  and fails if the committed fixtures have drifted (so the native port cannot
  silently desynchronise).
- Android `MotionDetectorParityTest` — reads those same 17 fixtures and asserts
  every impact field plus the motion timeline is identical.
- Android `MovementDetectorTest` — onset: walking, handling, car, bicycle, bus,
  vibration-with-no-GPS, GPS-alone, step veto.
- Backend — the additive wire format accepts `cycling`, every motion state and
  `repeats`, and still accepts old rows.

## Caveats (unchanged from the handoff, deliberately not hidden)

All thresholds were tuned on a synthetic simulator. The weakest are
`engineHfRms` (0.12), `pedalCorr` (0.3), `stepCorr` (0.55), `handDriftDeg` (12),
`handGyroDps` (25) and `vehicleMinRms` (0.1); they need real recordings before
they should be trusted. The ~0.46 ms per 100 samples figure is desktop Node, not
a mid-range phone, so the 2 ms budget is unconfirmed on device.

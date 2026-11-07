# Android Reliability, Lifecycle & Resource Benchmarks (Phase 2)

**Status:** Phase 2 Verified (`org.hodos.app`)  
**Target SDK / Min SDK:** Android 14+ (`UPSIDE_DOWN_CAKE` foreground location service type `0x8`) / Min SDK 24.

---

## 1. Foreground Service & Lifecycle Resilience (`HodosService.java`)

### 1.1 State Machine & Opt-In Safety
- **Explicit Armed Invariant:** `SharedPreferences("hodos").getBoolean("armed", false)` is persisted synchronously (`commit()`) whenever the user enables or disables autonomous mapping.
- **`START_STICKY` Process-Death Recovery:**
  - If Android reclaims `HodosService` under memory pressure while `armed == false`, `onStartCommand(null)` immediately calls `stopSelf()` and returns `START_NOT_STICKY`—never resurrecting background tracking after user opt-out.
  - If Android reclaims `HodosService` during an active journey (`tripActive == true`) and restarts it within 15 minutes of `tripLastCheckpoint`, `onCreate()` restores `activeTripId`, `tripStartedAt`, `cumulativeDistanceM`, `totalGpsFixes`, and reloads persisted `fixes` and `impacts` from [`TripDetailStore`](../../apps/web/android/app/src/main/java/org/hodos/app/TripDetailStore.kt) via `restoreSavedTrailState()`, then `resumeRecoveredTrip()` seamlessly re-attaches the accelerometer, fused location callback, and 2-second analysis scheduler without splitting the user's journey or duplicating already-enqueued impact IDs (`ObservationIds.impactRowId(tripId, impact.t)`).
  - If the service restarts more than 15 minutes after the last checkpoint, `sealStaleTrip()` commits the last checkpointed metrics to [`TripHistory`](../../apps/web/android/app/src/main/java/org/hodos/app/TripHistory.java) before clearing `tripActive`.

### 1.2 Idle vs. Active Power Profile
| Mode | Location Request | Accelerometer | Analysis Scheduler | Typical Battery Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Armed Idle (`!sampling`)** | `PRIORITY_BALANCED_POWER_ACCURACY` (25 s interval, 15 s min) + ActivityTransition API | Off (`unregisterListener`) | Off (`shutdownNow`) | $< 0.8\%\text{ / hr}$ |
| **Active Journey (`sampling`)** | `PRIORITY_HIGH_ACCURACY` (2 s interval) | `SENSOR_DELAY_GAME` ($\approx 50\text{ Hz}$) | Single-thread `2 000 ms` fixed delay | $\approx 3.2\text{–}4.5\%\text{ / hr}$ |

---

## 2. Atomic Local Persistence & Outbox Integrity

### 2.1 Durable SQLite Outbox (`EventOutbox.java` & `HodosSyncWorker.java`)
- **Idempotent Primary Keys:** Every road impact uses a deterministic primary key `ObservationIds.impactRowId(tripId, impact.t)` inserted with `SQLiteDatabase.CONFLICT_IGNORE`. Retries across network drops or service restarts never duplicate rows on Appwrite.
- **Transactional Quarantine (`rejected_events`):** Permanent HTTP 4xx validation rejections are moved atomically inside a SQLite transaction from `pending_events` to `rejected_events` (`quarantine(id, statusCode)`), preventing head-of-line blocking while preserving diagnostics until explicit user deletion (`clearRejected()`).
- **250 m Origin/Destination Privacy Zone:** Both live streaming (`analyse()`) and end-of-trip reconciliation (`endTrip()`) suppress hazard telemetry within $250\text{ m}$ of trip departure and arrival (Strava Metro / Apple Mobility privacy standard).

### 2.2 Crash-Safe Journey Storage (`TripHistory.java` & `TripDetailStore.kt`)
- **Bounded Summary History:** `TripHistory` retains at most 50 journey summaries in `SharedPreferences`, flushed synchronously via `.commit()` every 20 seconds during active trips and on `endTrip()`. Corrupt prior JSON never silently overwrites history.
- **Atomic Trail Writes:** `TripDetailStore.saveTrail()` writes route fixes and hazard waypoints to `$tripId.json.tmp` and atomically renames to `$tripId.json`, ensuring an abrupt power loss or OOM kill mid-flush cannot leave a truncated JSON file.

---

## 3. Location Quality & Multipath Jump Filtering (`LocationFixPolicy.kt`)

All incoming `FusedLocationProviderClient` fixes must pass `LocationFixPolicy.validRoadFix`:
1. **Not mocked:** `!location.isFromMockProvider`
2. **Freshness:** `0 <= nowMillis - fixMillis <= 30_000 ms` (15-minute fallback window used only for initial camera centering, never for road evidence).
3. **Geodetic validity:** `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`, finite `accuracyMeters ∈ [0, 50] m`.
4. **Physical speed bound:** `speedMetersPerSecond ∈ [0, 70] m/s` ($\le 252\text{ km/h}$).
5. **Multipath transition gate (`plausibleTransition`):** Consecutive fixes must satisfy $\Delta d \le 45\text{ m/s} \cdot \Delta t + 30\text{ m}$, rejecting urban-canyon GNSS reflections without discarding normal intersection stops.

---

## 4. Offline Map Reliability & Provider Compliance (`OfflineMaps.kt` & `OfflineDownloadPolicy.kt`)

- **Initialization Ordering:** `MapLibre.getInstance(app)` is always initialized on the main/synchronized path before `HttpRequestUtil.setOkHttpClient(client)` to prevent `ExceptionInInitializerError`.
- **OpenFreeMap Fair-Use Enforcement:**
  - OkHttp `Dispatcher` capped at `maxRequests = 4`, `maxRequestsPerHost = 4` with explicit `User-Agent: Hodos-Android/1.1 (https://github.com/DrSkyle/hodos)`.
  - Hard per-pack cap (`MAX_TILES = 2_400`, `MAX_BYTES = 45 MB`) and SDK-wide cap (`setOfflineMapboxTileCountLimit(4_800)` across `KEEP_REGIONS = 2`).
- **Wi-Fi & Location Quality Gates:** Automatic pack downloads require validated `TRANSPORT_WIFI`, a fresh fix ($\le 30\text{ s}$), and accuracy $\le 2\,500\text{ m}$. Losing Wi-Fi immediately transitions the active region to `OfflineRegion.STATE_INACTIVE` (`Paused · waiting for Wi-Fi`) and resumes automatically via `ConnectivityManager.NetworkCallback` when Wi-Fi returns.

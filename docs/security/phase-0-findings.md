# Phase 0 security findings

Baseline: `main` at `51f47ea277124d1bca5baba6507b2ae87f0f73be`
Reviewed: 2026-11-07

## Confirmed findings and status

| Finding | Severity | State |
|---|---|---|
| Android release keystore (`apps/web/android/app/release.keystore`) committed to public Git history | Critical | Removed from `security/phase-0-release-hardening` tree; historical blob remains in `main` (`b38355cf`) and tag `v1.2.0` |
| Android debug keystore (`apps/web/android/app/debug.keystore`) committed to public Git history | High | Removed from `security/phase-0-release-hardening` tree; historical blob remains in `main` (`9bfff3dd`) and tags `v1.1.25-beta.1`, `v1.2.0` |
| Hard-coded release signing fallback in Gradle (`hodosrelease2026` / `android`) | Critical | Replaced with fail-closed secret-only `validateReleaseSigning` task on this branch |
| Android release workflow published from every `main` push using a fixed `v1.2.0` tag | High | Replaced with semantic-tag-gated draft release workflow (`release-android.yml`) |
| Debug APK (`Hodos-1.2.0-debug.apk`) was published alongside the production release APK | High | New workflow publishes only the verified production APK |
| Release workflow did not validate signer fingerprint, `versionCode` monotonicity across all tags, or APK badging metadata | High | New workflow validates SHA-256 certificate digest, package ID, `versionName`, and `versionCode` monotonicity across all `v*` tags |
| Workflow token permissions were broader than required | Medium | Read-only defaults; `release` job alone receives `contents: write` |
| GitHub Actions referenced mutable version tags | Medium | Pinned to reviewed commit SHAs on this branch |
| CI dependency install was not frozen | Medium | Changed to `pnpm install --frozen-lockfile` |
| Injected localhost Impeccable live-preview script and token (`3fee00cb-0523-4759-ab71-59efea1353cf`) appeared in three web entry points | Low / hygiene | Removed from `apps/web/index.html`, `apps/web/map.html`, and `apps/web/map/index.html` |
| `main` branch has no branch protection or active rulesets, and `production-release` environment does not yet exist | High | Confirmed via GitHub REST API (`/rulesets` = `[]`, `/branches/main/protection` = `404`, `/environments` = `0`); documented exact CLI/UI commands in `github-repository-settings.md` |
| Appwrite `hazards` table is publicly readable and currently returns rows with `published: false` (`passCount: 1`, `deviceCount: 1`) to unauthenticated queries | Medium / Privacy | Confirmed via unauthenticated GET to `/v1/tablesdb/hodos/tables/hazards/rows`; fixed in Phase 3 aggregation so `hodos-aggregate` never writes uncorroborated (`published: false`) candidate rows to the public `hazards` table |

## Verified signing incident evidence

1. **Published `v1.2.0` production asset (`Hodos-1.2.0.apk`, 64,483,488 bytes)**:
   - Signed with the compromised `apps/web/android/app/release.keystore` (`PKCS12`, alias `hodos`, password `hodosrelease2026`, created `2026-11-03 04:09:06 UTC`).
   - Owner/Issuer: `CN=Hodos, OU=Mobile, O=Devilabs, L=Kathmandu, ST=Bagmati, C=NP`.
   - Serial number: `55816299c8e7bd48`.
   - Certificate SHA-256: `CC:9C:1F:E2:34:98:26:E3:BA:4D:FC:18:B4:C0:2B:72:9A:97:8D:A3:4A:E2:69:DB:01:C7:B5:5D:0B:22:A9:CF`.
   - Certificate SHA-1: `E8:13:0C:9A:FF:D7:9F:D3:F2:D2:44:96:4D:64:97:EF:D2:67:EB:7F`.
2. **Published `v1.2.0` debug asset (`Hodos-1.2.0-debug.apk`) and `v1.1.25-beta.1` asset (`Hodos-1.1.25-beta.apk`)**:
   - Signed with the committed `apps/web/android/app/debug.keystore` (`PKCS12`, alias `androiddebugkey`, password `android`, created `2026-11-03 02:48:31 UTC`).
   - Certificate SHA-256: `39:99:41:D3:08:DB:BB:DD:91:21:30:6F:4F:C4:A8:AC:38:9E:23:8C:66:A9:D1:94:09:F6:10:AB:11:E3:BB:E4`.
3. **F-Droid distribution status**:
   - `.fdroid/org.hodos.app.yml` was added in commit `736c747e` (`2026-11-03`). F-Droid builds from source and signs packages with its own independent signing key in the official F-Droid repo, so F-Droid installations do not share the GitHub release key.
4. **Forks and exposure scope**:
   - GitHub API (`GET /repos/DrSkyle/hodos`) confirms `visibility: public`, `forks_count: 0`, `stargazers_count: 0`, `subscribers_count: 0`.
   - Because the repository was public between `2026-11-03` and `2026-11-07`, both `release.keystore` (`CC:9C:1F:E2...`) and `debug.keystore` (`39:99:41:D3...`) must be treated as permanently compromised regardless of `forks_count: 0`.

## Verified live Appwrite permissions (Database `hodos`, Project `6ad7939a002ff135e419`)

Verified via non-destructive HTTP authorization probes against `https://sgp.cloud.appwrite.io/v1`:

| Resource & Action | Probe Result | Security Assessment |
|---|---|---|
| `events` — Anonymous Read (`GET /tables/events/rows`) | `HTTP 401 (user_unauthorized)` | **Secure:** Raw device telemetry and timestamps cannot be read by public/anonymous clients. |
| `events` — Anonymous Create (`POST /tables/events/rows`) | Allowed (`HTTP 400 row_invalid_structure` on invalid payload) | **Expected:** Required for zero-login anonymous observation uploads (`EventOutbox` / `HodosSyncWorker`). Validated strictly by `validEvent` in `hodos-aggregate`. |
| `hazards` — Anonymous Read (`GET /tables/hazards/rows`) | `HTTP 200` (`$permissions: []` on rows) | **Table-level public read enabled:** Required for public map display; `hodos-aggregate` must only write corroborated (`published: true`) hazards so single-device candidate points are never exposed. |
| `hazards` — Anonymous Create (`POST /tables/hazards/rows`) | `HTTP 401 (No permissions provided for action 'create')` | **Secure:** Clients cannot inject fake hazards into the public map. |
| `hazards` — Anonymous Update (`PATCH /tables/hazards/rows/<id>`) | `HTTP 401 (user_unauthorized)` | **Secure:** Clients cannot modify or tamper with existing hazard rows. |
| `hazards` — Anonymous Delete (`DELETE /tables/hazards/rows/<id>`) | `HTTP 401 (user_unauthorized)` | **Secure:** Clients cannot delete public hazards. |
| `functions/hodos-aggregate/executions` — Anonymous Read (`GET`) | `HTTP 401 (missing scopes executions.read)` | **Secure:** Execution logs and metadata are not publicly readable. |
| Table Schema Metadata (`GET /tables/hazards`, `/tables/events`) | `HTTP 401 (missing scopes tables.read)` | **Secure:** Administrative schema endpoints are restricted. |

## Required closure evidence

1. ~~Verify the v1.2.0 APK signer fingerprint from the original release artifact.~~ (Completed: `CC:9C:1F:E2:34:98:26:E3:BA:4D:FC:18:B4:C0:2B:72:9A:97:8D:A3:4A:E2:69:DB:01:C7:B5:5D:0B:22:A9:CF`)
2. ~~Approve a signer migration plan that addresses the compromised old key and existing installs.~~ (Completed: Retain `org.hodos.app` with a clean offline replacement key and explicit reinstall notice for `v1.2.0` testers; documented in `release-signing.md`)
3. ~~Complete an Appwrite permissions review.~~ (Completed via live non-destructive endpoint authorization probes above)
4. Purge `release.keystore` and `debug.keystore` from Git history in a coordinated operation after PR #11 merges (exact `git filter-repo` script documented in `release-signing.md`).
5. Configure the protected `production-release` environment and GitHub repository rulesets (`main` and `v*`) using the owner CLI commands in `github-repository-settings.md`.
6. Publish no production release until items 4 and 5 are executed by the owner.

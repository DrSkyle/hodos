# Android release signing and migration plan

## 1. Incident summary and verified fingerprints

Two Android keystores were committed to the public repository on `2026-11-03` and used to sign published GitHub release assets:

1. **`apps/web/android/app/release.keystore` (Compromised Production Signer)**
   - **Introduced in commit:** `b38355cf81ae716500f1ccfd3ee6c1bfcd9fe943` (`2026-11-03`)
   - **Used to sign:** `Hodos-1.2.0.apk` in release `v1.2.0`
   - **Keystore format / alias:** `PKCS12`, alias `hodos` (2048-bit RSA)
   - **Subject / Issuer:** `CN=Hodos, OU=Mobile, O=Devilabs, L=Kathmandu, ST=Bagmati, C=NP`
   - **Certificate SHA-256:** `CC:9C:1F:E2:34:98:26:E3:BA:4D:FC:18:B4:C0:2B:72:9A:97:8D:A3:4A:E2:69:DB:01:C7:B5:5D:0B:22:A9:CF`
   - **Certificate SHA-1:** `E8:13:0C:9A:FF:D7:9F:D3:F2:D2:44:96:4D:64:97:EF:D2:67:EB:7F`

2. **`apps/web/android/app/debug.keystore` (Compromised Debug Signer)**
   - **Introduced in commit:** `9bfff3ddc0a38614d7aa35fc337ccb420d98153b` (`2026-11-03`)
   - **Used to sign:** `Hodos-1.2.0-debug.apk` (`v1.2.0`) and `Hodos-1.1.25-beta.apk` (`v1.1.25-beta.1`)
   - **Keystore format / alias:** `PKCS12`, alias `androiddebugkey` (2048-bit RSA)
   - **Subject / Issuer:** `CN=Android Debug, O=Android, C=US`
   - **Certificate SHA-256:** `39:99:41:D3:08:DB:BB:DD:91:21:30:6F:4F:C4:A8:AC:38:9E:23:8C:66:A9:D1:94:09:F6:10:AB:11:E3:BB:E4`

Both private keys and their passwords were exposed in public Git history and must never be used to sign future releases or signing lineages.

---

## 2. Update migration evaluation & strategy

### Why APK Signing Key Rotation (lineage) must NOT be used
Android 9+ (API 28+) supports key rotation via an APK signing certificate lineage (`apksigner rotate`). However:
1. **Compromised root of trust:** Because anyone who cloned or scraped the repository holds the private key for `CC:9C:1F:E2...`, an attacker can independently generate competing `apksigner rotate` lineages or sign arbitrary malicious APKs with a higher `versionCode` that existing `v1.2.0` installations will accept as a trusted update.
2. **Legacy OS incompatibility:** Hodos supports `minSdk 23` (Android 6.0+). Devices running Android 6.0–8.1 ignore the v3 signing lineage block and verify only the v1/v2 signer unless dual-signed with the old compromised key—which would perpetuate use of the exposed key.

### Recommended migration path: Clean key replacement on `org.hodos.app`
1. **Generate a brand-new, uncompromised production signing key** offline on an owner-controlled machine (never linked to `CC:9C:1F:E2...`).
2. **Retain `applicationId "org.hodos.app"`** unless a large unmanaged fleet requires side-by-side coexistence. Because the repository was created recently (`forks_count: 0`) and `v1.2.0` was only published on `2026-11-03`, keeping `org.hodos.app` preserves package identity for F-Droid and documentation while severing cryptographic trust in the compromised key.
3. **Explicit user migration notice for `v1.2.0` installs:**
   - Any device with `v1.2.0` (`CC:9C:1F:E2...`) or a beta debug build (`39:99:41:D3...`) installed must **export any desired local trip history (GPX/GeoJSON), uninstall the existing app once (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), and install the newly signed release**.
   - Once a device installs the new release signed with the new private key, Android permanently pins the new certificate on that device and rejects any malicious APK signed with the old compromised `CC:9C:1F:E2...` key.
4. **Remove compromised `v1.2.0` and beta APK assets from GitHub Releases** as part of the coordinated cutover so new users cannot accidentally install an APK pinned to the compromised certificate.
5. **F-Droid compatibility:** F-Droid builds from source and signs packages with its own isolated key in the official F-Droid repository. Before submitting to `fdroiddata`, ensure the F-Droid build recipe invokes `./gradlew assembleRelease -x validateReleaseSigning` (with unsigned output for F-Droid's signer) or passes F-Droid's signing parameters.

---

## 3. Protected GitHub configuration

The production release workflow (`.github/workflows/release-android.yml`) requires a protected GitHub Actions environment named `production-release` with these secrets:

- `HODOS_KEYSTORE_BASE64`: Base64-encoded keystore bytes (PKCS12 or JKS).
- `HODOS_STORE_PASSWORD`: Keystore password.
- `HODOS_KEY_ALIAS`: Release key alias.
- `HODOS_KEY_PASSWORD`: Private-key password.

And this environment variable:

- `HODOS_SIGNING_CERT_SHA256`: Expected SHA-256 fingerprint of the new release certificate (must NOT be `CC:9C:1F:E2...` or `39:99:41:D3...`).

Optional environment variable:
- `HODOS_STORE_TYPE`: Optional explicit keystore type (`PKCS12` or `JKS`); omitted by default so Java `KeyStore` auto-detects PKCS12 and JKS transparently.

---

## 4. Owner-controlled key generation procedure

Generate the new signing identity on a trusted local machine (never in a cloud VM or CI runner, and never paste secrets into chat):

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore hodos-release-v2.keystore \
  -alias hodos -keyalg RSA -keysize 4096 -validity 10000
```

Keep at least two encrypted backups of `hodos-release-v2.keystore` in separate secure locations (e.g., hardware-backed password manager vault and offline encrypted drive).

Inspect the public certificate fingerprint locally:

```sh
keytool -list -v -keystore hodos-release-v2.keystore -alias hodos
```

Record the `SHA256` fingerprint for `HODOS_SIGNING_CERT_SHA256`.

Encode the keystore to Base64 locally without writing it into the repository:

```sh
base64 < hodos-release-v2.keystore | tr -d '\n'
```

Store the resulting Base64 string in the `production-release` environment secret `HODOS_KEYSTORE_BASE64` via the GitHub UI or local `gh secret set --env production-release`.

---

## 5. Coordinated Git history cleanup plan

Removing `release.keystore` and `debug.keystore` in a new commit leaves the binary blobs reachable in commit `b38355cf`, commit `9bfff3dd`, and tags `v1.1.25-beta.1` and `v1.2.0`.

**Do not execute the history rewrite until PR #11 is reviewed and you are ready to force-update refs.**

### Step-by-step execution plan (requires owner approval)
1. **Backup:** Create a full bare mirror backup locally (`git clone --mirror https://github.com/DrSkyle/hodos.git hodos-backup.git`).
2. **Delete compromised release assets:** Delete the `Hodos-1.2.0.apk`, `Hodos-1.2.0-debug.apk`, and `Hodos-1.1.25-beta.apk` assets (or replace `v1.2.0` with `v1.2.1` signed with the new key).
3. **Purge blobs across all refs using `git filter-repo`:**
   ```sh
   git filter-repo --invert-paths \
     --path apps/web/android/app/release.keystore \
     --path apps/web/android/app/debug.keystore \
     --force
   ```
4. **Verify zero remaining keystore objects:**
   ```sh
   git log --all --full-history -- "**/release.keystore" "**/debug.keystore" "*.keystore" "*.jks"
   ```
5. **Force-push cleaned branches and tags:**
   ```sh
   git push origin --force --all
   git push origin --force --tags
   ```
6. **Clean up local clones:** Any developer machine with an existing clone must either re-clone or run:
   ```sh
   git fetch --all --prune --tags --force
   git checkout main && git reset --hard origin/main
   git reflog expire --expire=now --all && git gc --prune=now --aggressive
   ```

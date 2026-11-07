# Android release signing

## Current security status

The Android release keystore was committed to the public repository and must
be treated as compromised. Do not use it for future production releases.

The repository's existing v1.2.0 users may have the old signing certificate
installed. A new certificate is not automatically an in-place update. Before
publishing a new APK, determine the installed-user migration strategy and test
it against the exact v1.2.0 APK on physical devices and emulators.

Android signing-key rotation uses a signing certificate lineage. Because the
old private key was exposed, a lineage must not be assumed to restore trust:
an attacker with the old key may be able to construct competing signed update
paths. Evaluate this threat explicitly before choosing rotation. If a trusted
update cannot be guaranteed, plan a deliberate reinstall/package migration
and communicate its impact. Do not silently change the signer.

## Protected GitHub configuration

The production release workflow expects these repository/environment secrets:

- `HODOS_KEYSTORE_BASE64`: Base64-encoded PKCS#12/JKS keystore bytes.
- `HODOS_STORE_PASSWORD`: keystore password.
- `HODOS_KEY_ALIAS`: release key alias.
- `HODOS_KEY_PASSWORD`: private-key password.

It also expects this environment variable:

- `HODOS_SIGNING_CERT_SHA256`: SHA-256 fingerprint of the intended release
  certificate, with or without colon separators.

Configure all five values in the protected GitHub Actions environment named
`production-release`. Require an authorized reviewer for this environment
before enabling production releases. Never put values in workflow YAML, source
files, issues, or chat messages.

## Local preparation and fingerprint

Generate or import the new signing identity on a trusted machine, offline where
possible. Keep at least two encrypted backups in separate secure locations.
Do not upload the keystore to GitHub, cloud storage, issue trackers, or source
control.

Obtain the public certificate fingerprint locally:

```sh
keytool -list -v -keystore hodos-release.p12 -alias hodos
```

Record the SHA-256 fingerprint only; the public certificate fingerprint is not
a secret. Compare it with the fingerprint printed by `apksigner verify
--print-certs` on the final APK.

Create the Base64 value without adding the keystore itself to the repository:

```sh
base64 < hodos-release.p12 | tr -d '\n'
```

Copy that output directly into the protected `HODOS_KEYSTORE_BASE64` secret.
Do not paste it into source files or a public conversation. Set the password
secrets and certificate fingerprint through GitHub's Actions environment UI.

## Release invariants

The tag, Gradle `versionName`, and APK metadata must agree. Production release
must be triggered by a semantic version tag (`vMAJOR.MINOR.PATCH`), never by
an arbitrary push to `main`. The workflow verifies:

1. Android unit and instrumentation tests pass on the configured API levels.
2. The release signing settings exist and the keystore is non-empty.
3. The APK signature verifies for the app's supported minimum SDK.
4. The signer SHA-256 matches `HODOS_SIGNING_CERT_SHA256`.
5. The package ID remains `org.hodos.app` unless a separately approved
   migration changes it.
6. The tag, Gradle version, and APK version metadata match.
7. Only the production APK is attached to a draft release; debug builds are
   never published as production assets.

The owner must review and publish the draft release manually after checking
the update/migration plan. Do not force-move a published release tag.

## Repository history

Deleting keystores from the current tree does not remove copies from old Git
commits, forks, cached archives, or downloaded clones. History rewriting is a
separate coordinated incident-response operation. Before doing it, preserve
the required public source state, notify collaborators, and plan for forks and
existing clones. The published private key must remain considered compromised
even after a history rewrite.

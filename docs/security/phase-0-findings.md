# Phase 0 security findings

Baseline: `main` at `51f47ea277124d1bca5baba6507b2ae87f0f73be`
Reviewed: 2026-11-07

## Confirmed

| Finding | Severity | State |
|---|---|---|
| Android release keystore committed to public Git history | Critical | Removed from this branch's current tree; historical copies remain exposed |
| Hard-coded release signing fallback in Gradle | Critical | Replaced with secret-only configuration on this branch |
| Android release workflow published from every main push using a fixed tag | High | Replaced with tag-gated draft release workflow on this branch |
| Debug APK was included in the public release assets | High | New workflow publishes only the production APK |
| Release workflow did not validate signer fingerprint or package/version metadata | High | New workflow validates these values |
| Workflow token permissions were broader than required | Medium | Read-only defaults; release job alone receives contents write |
| GitHub Actions referenced mutable version tags | Medium | Pinned to reviewed commit SHAs on this branch |
| CI dependency install was not frozen | Medium | Changed to `pnpm install --frozen-lockfile` |
| Injected localhost Impeccable live-preview script and token appeared in three web entry points | Low / hygiene | Removed from this branch; rotate/revoke the originating preview token |
| Main branch had no branch protection or rulesets | High | Documented settings required; not configured through current API access |

## Not yet verified

- Appwrite table permissions for `events`, `hazards`, and any related tables.
- Appwrite function execute permissions, API-key scope, runtime variables, and deployment configuration.
- Whether event insertion is public-create or constrained by another Appwrite authorization mechanism.
- The exact signing certificate fingerprint of the released v1.2.0 APK.
- The active users/install base and whether a safe signing-key migration can be performed.
- Whether F-Droid's published build and local install channel use different signing identities.
- Whether old release keystore contents have been cached or cloned outside GitHub.

## Required closure evidence

1. Verify the v1.2.0 APK signer fingerprint from the original release artifact.
2. Approve a signer migration plan that addresses the compromised old key and existing installs.
3. Purge signing material from Git history in a coordinated operation and rotate/revoke any associated credentials.
4. Configure the protected `production-release` environment and GitHub repository rules.
5. Complete an Appwrite permissions and API-key review.
6. Test clean install and upgrade behavior for each supported distribution channel.
7. Publish no production release until all preceding items are closed.

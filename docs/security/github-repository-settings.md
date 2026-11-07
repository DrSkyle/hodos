# GitHub repository security settings

These controls are not fully expressible through the current connected GitHub
API. Configure them in the repository settings after reviewing this Phase 0
change.

## Protect `main`

Open **Settings → Rules → Rulesets** and create an active branch ruleset for
`main`:

- Require a pull request before merging.
- Require the `CI / test` and `Android verification / verify` status checks.
- Require conversation resolution.
- Dismiss stale approvals when new commits are pushed.
- Block force pushes and branch deletion.
- Do not allow ordinary workflows to bypass the rules.
- Keep administrator bypass limited to an intentional break-glass path.

Require at least one independent approval once a second trusted maintainer is
available. Do not configure a one-approval rule while the repository has only
one eligible reviewer; that would create a merge deadlock rather than real
review.

## Protect release tags

Create a tag ruleset matching `v*`:

- Restrict tag updates and deletion.
- Restrict tag creation to repository maintainers.
- Do not allow ordinary CI jobs or deployment tokens to bypass the rule.

The release workflow independently verifies that a version tag points to a
commit reachable from `main`.

## Protect the production release environment

Open **Settings → Environments** and create `production-release`:

- Require a trusted reviewer before deployment.
- Prevent self-review where the repository plan supports it.
- Restrict deployment branches/tags to version tags matching `v*`.
- Store the four signing values as environment secrets:
  `HODOS_KEYSTORE_BASE64`, `HODOS_STORE_PASSWORD`, `HODOS_KEY_ALIAS`,
  and `HODOS_KEY_PASSWORD`.
- Store `HODOS_SIGNING_CERT_SHA256` as an environment variable.

Do not copy the exposed v1.2.0 signing key back into the environment. Only add
the new key after the owner-approved update migration has been tested.

## Limit Actions permissions

- Set the repository's default workflow token permission to read-only.
- Require explicit per-job write permissions only for the draft release job.
- Restrict allowed Actions to the specific actions Hodos uses, if that setting
  is compatible with the repository's maintenance workflow.
- Enable secret scanning and push protection where available.
- Review all repository, organization, and environment secrets. Remove
  obsolete signing secrets after the replacement signer has been chosen.

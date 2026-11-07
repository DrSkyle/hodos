# GitHub repository security settings

## Current live repository audit (verified via GitHub REST API)

- **Repository visibility:** `public` (`forks_count: 0`)
- **Rulesets (`GET /repos/DrSkyle/hodos/rulesets`):** `[]` (none configured)
- **Branch protection (`GET /repos/DrSkyle/hodos/branches/main/protection`):** `404 Branch not protected`
- **Environments (`GET /repos/DrSkyle/hodos/environments`):** `0` environments (`production-release` not yet created)
- **Default workflow token permissions:** `read` (`can_approve_pull_request_reviews: false`) — **already compliant**
- **Secret scanning & push protection:** `secret_scanning: enabled`, `secret_scanning_push_protection: enabled` — **already compliant**
- **Actions allow-list:** `allowed_actions: all`, `sha_pinning_required: false` (all workflows in repo now pin third-party actions to full commit SHAs)

Because the remote agent's scoped GitHub App token has read access to repository rules/settings and write access to code branches, apply the administrative ruleset and environment settings below from an authenticated owner shell (`gh` with `repo` / `admin:repo_hook` scope) or via the GitHub Settings UI.

---

## 1. Create the protected `production-release` environment

Open **Settings → Environments → New environment** and name it `production-release`:

1. Enable **Required reviewers** and add `DrSkyle`.
2. Under **Deployment branches and tags**, select **Selected branches and tags** and add a tag pattern rule for `v*` (restricting environment access exclusively to version tags).
3. Add the four environment secrets (using the newly generated offline keystore, **never** the compromised `CC:9C:1F:E2...` key):
   - `HODOS_KEYSTORE_BASE64`
   - `HODOS_STORE_PASSWORD`
   - `HODOS_KEY_ALIAS`
   - `HODOS_KEY_PASSWORD`
4. Add the environment variable:
   - `HODOS_SIGNING_CERT_SHA256` (set to the SHA-256 fingerprint of the new certificate).

Equivalent `gh` CLI commands (run locally where your new keystore resides):

```sh
# After creating the environment and reviewer rule in Settings -> Environments:
gh secret set HODOS_KEYSTORE_BASE64 --env production-release -R DrSkyle/hodos < <(base64 < hodos-release-v2.keystore | tr -d '\n')
gh secret set HODOS_STORE_PASSWORD --env production-release -R DrSkyle/hodos
gh secret set HODOS_KEY_ALIAS --env production-release -R DrSkyle/hodos
gh secret set HODOS_KEY_PASSWORD --env production-release -R DrSkyle/hodos
gh variable set HODOS_SIGNING_CERT_SHA256 --env production-release -R DrSkyle/hodos --body "<NEW_CERT_SHA256>"
```

---

## 2. Protect `main` with a repository branch ruleset

Open **Settings → Rules → Rulesets → New branch ruleset** (or run the `gh api` command below):

- **Ruleset Name:** `main-protection`
- **Enforcement status:** `Active`
- **Target branches:** Include default branch (`main`)
- **Rules enabled:**
  - Restrict deletions
  - Block force pushes
  - Require a pull request before merging (`required_approving_review_count: 0` while solo-maintained to avoid merge deadlock; increase to `1` when a second maintainer is added; enable `require_last_push_approval: false`, `dismiss_stale_reviews_on_push: true`, `required_review_thread_resolution: true`)
  - Require status checks to pass: `test` (`CI`) and `verify` (`Android verification`)

Equivalent `gh api` command:

```sh
gh api -X POST repos/DrSkyle/hodos/rulesets --input - <<'EOF'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "test" },
          { "context": "verify" }
        ]
      }
    }
  ]
}
EOF
```

---

## 3. Protect release tags (`v*`) with a tag ruleset

Create an active tag ruleset so release tags cannot be force-moved or deleted:

```sh
gh api -X POST repos/DrSkyle/hodos/rulesets --input - <<'EOF'
{
  "name": "release-tags-protection",
  "target": "tag",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/tags/v*"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "update" }
  ]
}
EOF
```

---

## 4. Require SHA pinning for GitHub Actions

In **Settings → Actions → General**, check **Require actions to be pinned to a full-length commit SHA**, or run:

```sh
gh api -X PUT repos/DrSkyle/hodos/actions/permissions \
  -F enabled=true -f allowed_actions=all -F sha_pinning_required=true
```

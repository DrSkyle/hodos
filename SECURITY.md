# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/DrSkyle/hodos/security/advisories/new).

Do not publish exploit details, credentials, signing material, personal data, or
sensitive production configuration in a public issue.

Include the affected release or commit, impact, reproduction steps, and any
available logs or proof of concept. Remove personal information and secrets
from all evidence.

## Supported versions

Security fixes are prioritized for the latest supported release on the
`main` branch. Older releases may not receive fixes; update to the latest
verified release when one is available.

## Release integrity

Production APKs must be built only by the protected Android release workflow.
The workflow must use a private signing key supplied through protected GitHub
Actions secrets, verify its SHA-256 signing-certificate fingerprint, and
produce a draft release for owner review.

No signing keystore, signing password, API key, access token, or private
certificate material may be committed to this repository.

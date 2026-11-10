#!/usr/bin/env bash
# Rotate the Android release signing key and wire it into GitHub Actions.
#
# The new key is created on your machine, never committed. Only the base64
# blob goes to GitHub as a secret, and the plaintext file is left in place for
# you to back up.
#
#   ./scripts/rotate-release-key.sh                    # generate + set secrets
#   ./scripts/rotate-release-key.sh --keystore ~/x.jks # use an existing key
#   ./scripts/rotate-release-key.sh --dry-run          # plan only, no writes
#   ./scripts/rotate-release-key.sh --audit            # compare live cert only
#
# Requirements: keytool (JDK 17+), gh (authenticated with repo + workflow scope).
set -euo pipefail

REPO="DrSkyle/hodos"
ALIAS="hodos"
DN="C=US, O=Devilabs, OU=Engineering, CN=Hodos"
KEYSTORE="${HOME}/hodos-release-$(date -u +%Y%m%d).keystore"
GENERATE=1
DRY_RUN=0
AUDIT_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keystore) KEYSTORE="$2"; GENERATE=0; shift 2 ;;
    --alias)    ALIAS="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --audit)    AUDIT_ONLY=1; shift ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

command -v keytool >/dev/null || die "keytool not found — install a JDK 17+ and set PATH"
command -v gh >/dev/null || die "gh not found — install the GitHub CLI"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

# ---------------------------------------------------------------- audit mode
live_cert_fingerprint() {
  # Reads the signer of the newest published release APK, which is the only
  # trustworthy statement of what the live key actually is.
  local tag tmp
  tag="$(gh release list --repo "$REPO" --limit 1 --json tagName -q '.[0].tagName')"
  [[ -z "$tag" ]] && die "no published release to audit"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  gh release download "$tag" --repo "$REPO" --pattern "Hodos-*.apk" --dir "$tmp" >/dev/null
  local apk
  apk="$(find "$tmp" -name 'Hodos-*.apk' | head -1)"
  local apksigner
  apksigner="$(find "${ANDROID_HOME:-$HOME/Library/Android/sdk}" -name apksigner -type f 2>/dev/null | sort -V | tail -1)"
  [[ -z "$apksigner" ]] && die "apksigner not found — set ANDROID_HOME"
  "$apksigner" verify --print-certs "$apk" 2>/dev/null \
    | sed -n 's/.*certificate SHA-256 digest: //p' | head -1
}

if [[ "$AUDIT_ONLY" == "1" ]]; then
  say "Auditing the live release signer"
  live_cert_fingerprint || die "could not read the live signer"
  echo
  echo "Compare that digest with any known-compromised fingerprint."
  echo "If it matches, rotate immediately by running this script without --audit."
  exit 0
fi

# ------------------------------------------------------------- new keystore
if [[ "$GENERATE" == "1" ]]; then
  if [[ -e "$KEYSTORE" ]]; then
    die "refusing to overwrite existing keystore: $KEYSTORE"
  fi
  say "Generating a new 4096-bit RSA keystore"
  echo "Path:   $KEYSTORE"
  echo "Alias:  $ALIAS"
  echo "You will be asked for a store password. Use a long unique one from a"
  echo "password manager — you cannot recover the app without it."
  echo
  [[ "$DRY_RUN" == "1" ]] && { echo "[dry-run] would run keytool -genkeypair"; exit 0; }
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "$DN"
else
  [[ -f "$KEYSTORE" ]] || die "keystore not found: $KEYSTORE"
  say "Using existing keystore"
  echo "Path: $KEYSTORE"
fi

# ------------------------------------------------------- read the fingerprint
say "Reading the signing certificate fingerprint"
CERT_SHA256="$(
  keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" 2>/dev/null \
    | sed -n 's/.*SHA256: //p' | head -1
)"
[[ -z "$CERT_SHA256" ]] && die "could not read the certificate (wrong alias or password?)"
echo "SHA-256: $CERT_SHA256"

# ------------------------------------------------------------- set secrets
say "Setting GitHub Actions secrets on $REPO"
KS_B64_FILE="$(mktemp)"
base64 < "$KEYSTORE" | tr -d '\n' > "$KS_B64_FILE"
trap 'rm -f "$KS_B64_FILE"' EXIT

echo "You will be prompted for the store password and key password."
echo "For a PKCS12 keystore these are normally the same value."
echo
[[ "$DRY_RUN" == "1" ]] && { echo "[dry-run] would set 5 secrets"; exit 0; }

gh secret set HODOS_KEYSTORE_BASE64     --repo "$REPO" < "$KS_B64_FILE"
gh secret set HODOS_KEY_ALIAS           --repo "$REPO" --body "$ALIAS"
gh secret set HODOS_SIGNING_CERT_SHA256 --repo "$REPO" --body "$CERT_SHA256"
gh secret set HODOS_STORE_PASSWORD      --repo "$REPO"
gh secret set HODOS_KEY_PASSWORD        --repo "$REPO"

say "Verifying the secrets are present"
gh secret list --repo "$REPO" | grep -E "HODOS_(KEYSTORE_BASE64|KEY_ALIAS|STORE_PASSWORD|KEY_PASSWORD|SIGNING_CERT_SHA256)" || \
  die "one or more secrets are missing"

say "Rotated. Next steps"
cat <<EOF
1. BACK UP the keystore and both passwords now. Without them you can never
   ship an update to this app identity.

     $KEYSTORE

2. Bump the version so the next release is distinct:
     apps/web/android/app/build.gradle  ->  versionCode +1, versionName

3. Cut a release when you are ready (this script never tags or releases):
     git tag vX.Y.Z && git push origin vX.Y.Z

4. Expect the next release to be a NEW app identity for anyone who installed
   under the previous key. They must uninstall/reinstall once; app data will
   not carry across the key change.
EOF

#!/usr/bin/env bash
# Deploy the Hodos Garage backend: affiliate offers + the road-notes list.
#
# Prerequisites:
#   appwrite login                    # session must be valid
# Then: scripts/deploy-affiliate.sh
#
# Creates:
#   - subscribers: email list, no client permissions at all. Rows are written
#     only by the function, keyed by a hash of the address so the same address
#     cannot be stored twice.
#   - hodos-affiliate: accepts newsletter signups and nothing else. Execute
#     permission: any. There is no catalogue key here any more.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"
CONFIG_FILE="${HODOS_APPWRITE_CONFIG:-}"

appwrite client -e "$ENDPOINT" -p "$PROJECT" >/dev/null

if ! appwrite tablesdb get-table --database-id "$DB" --table-id subscribers >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id subscribers \
    --name "Subscribers" \
    --columns '{"key":"email","type":"varchar","size":254,"required":true}' \
    --columns '{"key":"source","type":"varchar","size":32,"required":true}' \
    --columns '{"key":"consent","type":"varchar","size":32,"required":true}' \
    --columns '{"key":"at","type":"datetime","required":true}' \
    --indexes '{"key":"by_at","type":"key","attributes":["at"]}'
fi

if ! appwrite functions get --function-id hodos-affiliate >/dev/null 2>&1; then
  appwrite functions create --function-id hodos-affiliate \
    --name "Hodos Garage" --runtime node-22 --entrypoint src/main.js \
    --timeout 30 --execute any \
    --scopes tables.read --scopes rows.read --scopes rows.write
fi

set_func_var() {
  local key="$1"
  local val="$2"
  local existing_id
  existing_id="$(appwrite functions list-variables --function-id hodos-affiliate -j 2>/dev/null \
    | node -e 'const d = JSON.parse(require("fs").readFileSync(0,"utf8")); const v = (d.variables||[]).find(x=>x.key===process.argv[1]); if(v) console.log(v.$id);' "$key" || true)"
  if [[ -n "$existing_id" ]]; then
    appwrite functions update-variable --function-id hodos-affiliate --variable-id "$existing_id" --key "$key" --value "$val" >/dev/null
  else
    appwrite functions create-variable --function-id hodos-affiliate --key "$key" --value "$val" >/dev/null
  fi
}

if [[ -n "${RESEND_API_KEY:-}" ]]; then
  set_func_var "RESEND_API_KEY" "$RESEND_API_KEY"
  echo "Configured RESEND_API_KEY on hodos-affiliate."
fi

if [[ -n "${RESEND_FROM:-}" ]]; then
  set_func_var "RESEND_FROM" "$RESEND_FROM"
  echo "Configured RESEND_FROM on hodos-affiliate."
fi

appwrite functions create-deployment \
  --function-id hodos-affiliate \
  --code appwrite/functions/hodos-affiliate \
  --entrypoint src/main.js --activate

echo "Garage & newsletter backend deployed."

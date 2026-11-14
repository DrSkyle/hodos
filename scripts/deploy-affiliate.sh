#!/usr/bin/env bash
# Deploy the Hodos Garage backend: affiliate offers + the road-notes list.
#
# Prerequisites:
#   appwrite login                    # session must be valid
#   export CHANNEL3_API_KEY="..."     # Channel3 key, kept server-side only
#
# Then: CHANNEL3_API_KEY=... scripts/deploy-affiliate.sh
#
# Creates:
#   - subscribers: email list, no client permissions at all. Rows are written
#     only by the function, keyed by a hash of the address so the same address
#     cannot be stored twice.
#   - hodos-affiliate: proxies Channel3 search for a fixed set of Garage slots
#     and accepts newsletter signups. Execute permission: any. The Channel3 key
#     is a secret function variable and never reaches a browser or an APK.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"
CONFIG_FILE="${HODOS_APPWRITE_CONFIG:-}"

if [[ -z "${CHANNEL3_API_KEY:-}" ]]; then
  echo "error: set CHANNEL3_API_KEY (server-side Channel3 key)" >&2
  exit 1
fi

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

# Keep the deployed key in step with the shell's copy.
VARIABLE_ID="$(appwrite functions list-variables --function-id hodos-affiliate -j 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);const list=p.variables||p;const hit=(Array.isArray(list)?list:[]).find(v=>v.key==="CHANNEL3_API_KEY");process.stdout.write(hit&&hit.$id?hit.$id:"")}catch{process.stdout.write("")}})')"
if [[ -n "$VARIABLE_ID" ]]; then
  appwrite functions update-variable --function-id hodos-affiliate \
    --variable-id "$VARIABLE_ID" --key CHANNEL3_API_KEY \
    --value "$CHANNEL3_API_KEY" --secret >/dev/null
else
  appwrite functions create-variable --function-id hodos-affiliate \
    --variable-id channel3_api_key \
    --key CHANNEL3_API_KEY --value "$CHANNEL3_API_KEY" --secret >/dev/null
fi

appwrite functions create-deployment \
  --function-id hodos-affiliate \
  --code appwrite/functions/hodos-affiliate \
  --entrypoint src/main.js --activate

echo "Garage backend deployed."

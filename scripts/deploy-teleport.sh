#!/usr/bin/env bash
# Deploy Admitad Teleport for Hodos.
#
# Prerequisites:
#   appwrite login
#   ADMITAD_ACCESS_TOKEN="..."   # only if your account requires an API token
#
# Then: scripts/deploy-teleport.sh
#
# Creates:
#   - teleportClicks: NO client permissions. One row per click attempt, holding
#     only the link id, whether it resolved, and when. No visitor identifiers.
#   - hodos-teleport: resolves an Admitad affiliate link server-side, because
#     Teleport refuses browser requests. Execute permission: any.
#
# This function never runs without consent: the visitor's IP, user agent and
# referer are online identifiers, and Admitad's publisher terms require consent
# before passing them.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"

appwrite client -e "$ENDPOINT" -p "$PROJECT" >/dev/null

if ! appwrite tablesdb get-table --database-id "$DB" --table-id teleportClicks >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id teleportClicks \
    --name "Teleport clicks" \
    --columns '{"key":"hash","type":"varchar","size":128,"required":false}' \
    --columns '{"key":"ok","type":"boolean","required":true}' \
    --columns '{"key":"reason","type":"varchar","size":64,"required":false}' \
    --columns '{"key":"at","type":"datetime","required":true}' \
    --indexes '{"key":"by_at","type":"key","attributes":["at"]}'
fi

if ! appwrite functions get --function-id hodos-teleport >/dev/null 2>&1; then
  appwrite functions create --function-id hodos-teleport \
    --name "Hodos Teleport" --runtime node-22 --entrypoint src/main.js \
    --timeout 20 --execute any \
    --scopes tables.read --scopes rows.read --scopes rows.write
fi

# Optional API token, when the account requires one for Teleport.
if [[ -n "${ADMITAD_ACCESS_TOKEN:-}" ]]; then
  VARIABLE_ID="$(appwrite functions list-variables --function-id hodos-teleport -j 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);const list=p.variables||p;const hit=(Array.isArray(list)?list:[]).find(v=>v.key==="ADMITAD_ACCESS_TOKEN");process.stdout.write(hit&&hit.$id?hit.$id:"")}catch{process.stdout.write("")}})')"
  if [[ -n "$VARIABLE_ID" ]]; then
    appwrite functions update-variable --function-id hodos-teleport \
      --variable-id "$VARIABLE_ID" --key ADMITAD_ACCESS_TOKEN \
      --value "$ADMITAD_ACCESS_TOKEN" --secret >/dev/null
  else
    appwrite functions create-variable --function-id hodos-teleport \
      --variable-id admitad_access_token \
      --key ADMITAD_ACCESS_TOKEN --value "$ADMITAD_ACCESS_TOKEN" --secret >/dev/null
  fi
fi

appwrite functions create-deployment \
  --function-id hodos-teleport \
  --code appwrite/functions/hodos-teleport \
  --entrypoint src/main.js --activate

echo "Teleport deployed."

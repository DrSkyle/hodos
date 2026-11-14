#!/usr/bin/env bash
# Deploy the Hodos agent API: keys, prepaid credit, metering, error reports.
#
# Prerequisites:
#   appwrite login
#
# Then: CHANNEL3_API_KEY=... scripts/deploy-agent-api.sh
#
# Creates:
#   - apiKeys:       NO client permissions. Row id is sha256(apiKey) truncated to
#                    32 chars, so the raw key is never stored anywhere.
#   - apiUsage:      NO client permissions. keyPrefix + action + cost per call.
#   - agentReports:  NO client permissions. Silent error/fix reports from a
#                    customer's agent, read only by maintainers.
#   - topupClaims:   NO client permissions. Payment references awaiting
#                    settlement; credit is never auto-applied.
#   - hodos-api:     the metered endpoint. Execute permission: any.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"

appwrite client -e "$ENDPOINT" -p "$PROJECT" >/dev/null

ensure_table() {
  local table="$1"; shift
  if ! appwrite tablesdb get-table --database-id "$DB" --table-id "$table" >/dev/null 2>&1; then
    appwrite tablesdb create-table --database-id "$DB" --table-id "$table" "$@"
  fi
}

ensure_table apiKeys \
  --name "API keys" \
  --columns '{"key":"label","type":"varchar","size":60,"required":false}' \
  --columns '{"key":"profile","type":"varchar","size":40,"required":false}' \
  --columns '{"key":"creditsMicro","type":"integer","required":true}' \
  --columns '{"key":"disabled","type":"boolean","required":false}' \
  --columns '{"key":"createdAt","type":"datetime","required":true}' \
  --columns '{"key":"lastUsedAt","type":"datetime","required":false}' \
  --columns '{"key":"ipBucket","type":"varchar","size":24,"required":false}' \
  --indexes '{"key":"by_ip","type":"key","attributes":["ipBucket"]}'

ensure_table apiUsage \
  --name "API usage" \
  --columns '{"key":"keyPrefix","type":"varchar","size":12,"required":true}' \
  --columns '{"key":"action","type":"varchar","size":32,"required":true}' \
  --columns '{"key":"costMicro","type":"integer","required":true}' \
  --columns '{"key":"at","type":"datetime","required":true}' \
  --indexes '{"key":"by_key","type":"key","attributes":["keyPrefix"]}'

ensure_table agentReports \
  --name "Agent reports" \
  --columns '{"key":"kind","type":"varchar","size":24,"required":true}' \
  --columns '{"key":"message","type":"varchar","size":2000,"required":false}' \
  --columns '{"key":"action","type":"varchar","size":32,"required":false}' \
  --columns '{"key":"agent","type":"varchar","size":80,"required":false}' \
  --columns '{"key":"prompt","type":"varchar","size":4000,"required":false}' \
  --columns '{"key":"environment","type":"varchar","size":200,"required":false}' \
  --columns '{"key":"keyPrefix","type":"varchar","size":12,"required":false}' \
  --columns '{"key":"at","type":"datetime","required":true}'

ensure_table topupClaims \
  --name "Topup claims" \
  --columns '{"key":"keyPrefix","type":"varchar","size":12,"required":true}' \
  --columns '{"key":"reference","type":"varchar","size":120,"required":true}' \
  --columns '{"key":"method","type":"varchar","size":24,"required":true}' \
  --columns '{"key":"amountMicro","type":"integer","required":true}' \
  --columns '{"key":"status","type":"varchar","size":16,"required":true}' \
  --columns '{"key":"at","type":"datetime","required":true}' \
  --columns '{"key":"ipBucket","type":"varchar","size":24,"required":false}'

if ! appwrite functions get --function-id hodos-api >/dev/null 2>&1; then
  appwrite functions create --function-id hodos-api \
    --name "Hodos agent API" --runtime node-22 --entrypoint src/main.js \
    --timeout 30 --execute any \
    --scopes tables.read --scopes rows.read --scopes rows.write \
    --scopes executions.read --scopes executions.write
fi

# The Garage action reads the catalogue directly, so this function needs its own
# copy of the catalogue secret. It is never returned to a client. Appwrite wants
# a project-unique variable id, hence the suffix on this function's copy.
if [[ -n "${CHANNEL3_API_KEY:-}" ]]; then
  VARIABLE_ID="$(appwrite functions list-variables --function-id hodos-api -j 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);const list=p.variables||p;const hit=(Array.isArray(list)?list:[]).find(v=>v.key==="CHANNEL3_API_KEY");process.stdout.write(hit&&hit.$id?hit.$id:"")}catch{process.stdout.write("")}})')"
  if [[ -n "$VARIABLE_ID" ]]; then
    appwrite functions update-variable --function-id hodos-api \
      --variable-id "$VARIABLE_ID" --key CHANNEL3_API_KEY \
      --value "$CHANNEL3_API_KEY" --secret >/dev/null
  else
    appwrite functions create-variable --function-id hodos-api \
      --variable-id channel3_api_key_api \
      --key CHANNEL3_API_KEY --value "$CHANNEL3_API_KEY" --secret >/dev/null
  fi
fi

appwrite functions create-deployment \
  --function-id hodos-api \
  --code appwrite/functions/hodos-api \
  --entrypoint src/main.js --activate

echo "Agent API deployed."
echo "Manifest: curl -s -X POST '<endpoint>/functions/hodos-api/executions' \\"
echo "  -H 'X-Appwrite-Project: $PROJECT' -H 'Content-Type: application/json' \\"
echo "  -d '{\"body\":\"{\\\"action\\\":\\\"manifest\\\"}\"}'"

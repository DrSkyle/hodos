#!/usr/bin/env bash
# Deploy the anonymous partner footfall backend.
#
# Prerequisites:
#   appwrite login                    # session must be valid
#   (or) appwrite client -k <API_KEY> # project key with tables + functions write
#
# Then: scripts/deploy-partner-stats.sh
#
# Creates:
#   - partnerPasses: NO client permissions. Holds only partnerId, a blinded
#     passToken (salted by shop + month) and the month/day.
#   - partnerRate: NO client permissions. Per-IP hourly ingest counters.
#   - partnerStats: public read, server write. uniqueDevices per partner/month.
#   - hodos-partner-pass: the only writer of partnerPasses. Verifies proof of
#     work, dedupes, and rate-limits. Execute permission: any.
#   - hodos-partner-stats: hourly aggregation into partnerStats.
#
# If partnerPasses already exists from an earlier deployment, make sure it has
# no create("any") permission and has the `day` column before running this.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"
CONFIG="${HODOS_APPWRITE_CONFIG:-}"

appwrite client -e "$ENDPOINT" -p "$PROJECT" >/dev/null
FLAGS=()
if [[ -n "$CONFIG" ]]; then FLAGS=(--config-file "$CONFIG"); fi

if ! appwrite tablesdb get-table --database-id "$DB" --table-id partnerPasses "${FLAGS[@]}" >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id partnerPasses \
    --name "Partner passes" \
    --columns '{"key":"partnerId","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"passToken","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"month","type":"varchar","size":7,"required":true}' \
    --columns '{"key":"day","type":"varchar","size":10,"required":true}' \
    --indexes '{"key":"by_month","type":"key","attributes":["month"]}' \
    --indexes '{"key":"by_partner_day","type":"key","attributes":["partnerId","day"]}' \
    "${FLAGS[@]}"
fi

if ! appwrite tablesdb get-table --database-id "$DB" --table-id partnerRate "${FLAGS[@]}" >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id partnerRate \
    --name "Partner rate limits" \
    --columns '{"key":"bucket","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"count","type":"integer","required":true}' \
    --columns '{"key":"hour","type":"varchar","size":13,"required":true}' \
    --indexes '{"key":"by_hour","type":"key","attributes":["hour"]}' \
    "${FLAGS[@]}"
fi

if ! appwrite tablesdb get-table --database-id "$DB" --table-id partnerStats "${FLAGS[@]}" >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id partnerStats \
    --name "Partner stats" --permissions 'read("any")' \
    --columns '{"key":"partnerId","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"month","type":"varchar","size":7,"required":true}' \
    --columns '{"key":"uniqueDevices","type":"integer","required":true}' \
    --columns '{"key":"updatedAt","type":"datetime","required":false}' \
    --indexes '{"key":"by_month","type":"key","attributes":["month"]}' \
    "${FLAGS[@]}"
fi

if ! appwrite functions get --function-id hodos-partner-pass "${FLAGS[@]}" >/dev/null 2>&1; then
  appwrite functions create --function-id hodos-partner-pass \
    --name "Hodos partner pass ingest" --runtime node-22 --entrypoint src/main.js \
    --timeout 30 --execute any \
    --scopes tables.read --scopes rows.read --scopes rows.write \
    "${FLAGS[@]}"
fi

if ! appwrite functions get --function-id hodos-partner-stats "${FLAGS[@]}" >/dev/null 2>&1; then
  appwrite functions create --function-id hodos-partner-stats \
    --name "Hodos partner stats" --runtime node-22 --entrypoint src/main.js \
    --timeout 60 --interval 60 \
    --scopes tables.read --scopes rows.read --scopes rows.write \
    "${FLAGS[@]}"
fi

appwrite functions create-deployment \
  --function-id hodos-partner-pass \
  --code appwrite/functions/hodos-partner-pass \
  --entrypoint src/main.js --activate "${FLAGS[@]}"

appwrite functions create-deployment \
  --function-id hodos-partner-stats \
  --code appwrite/functions/hodos-partner-stats \
  --entrypoint src/main.js --activate "${FLAGS[@]}"

echo "Partner backend deployed."
echo "Smoke test: appwrite functions create-execution --function-id hodos-partner-stats"

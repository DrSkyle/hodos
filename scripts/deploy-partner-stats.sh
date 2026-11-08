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
#   - partnerPasses: public create, private read. Holds only partnerId,
#     a blinded passToken (salted by shop + month) and the month.
#   - partnerStats: public read, server write. Holds uniqueDevices per partner
#     and month, so the app can show "N drivers passed this shop this month".
#   - hodos-partner-stats function: hourly aggregation.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"

appwrite client -e "$ENDPOINT" -p "$PROJECT" >/dev/null

if ! appwrite tablesdb get-table --database-id "$DB" --table-id partnerPasses >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id partnerPasses \
    --name "Partner passes" --permissions 'create("any")' \
    --columns '{"key":"partnerId","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"passToken","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"month","type":"varchar","size":7,"required":true}' \
    --indexes '{"key":"by_month","type":"key","attributes":["month"]}'
fi

if ! appwrite tablesdb get-table --database-id "$DB" --table-id partnerStats >/dev/null 2>&1; then
  appwrite tablesdb create-table --database-id "$DB" --table-id partnerStats \
    --name "Partner stats" --permissions 'read("any")' \
    --columns '{"key":"partnerId","type":"varchar","size":64,"required":true}' \
    --columns '{"key":"month","type":"varchar","size":7,"required":true}' \
    --columns '{"key":"uniqueDevices","type":"integer","required":true}' \
    --columns '{"key":"updatedAt","type":"datetime","required":false}' \
    --indexes '{"key":"by_month","type":"key","attributes":["month"]}'
fi

if ! appwrite functions get --function-id hodos-partner-stats >/dev/null 2>&1; then
  appwrite functions create --function-id hodos-partner-stats \
    --name "Hodos partner stats" --runtime node-22 --entrypoint src/main.js \
    --timeout 60 --interval 60 \
    --scopes tables.read --scopes rows.read --scopes rows.write
fi

appwrite functions create-deployment \
  --function-id hodos-partner-stats \
  --code appwrite/functions/hodos-partner-stats \
  --entrypoint src/main.js \
  --activate

echo "Partner stats deployed. Run: appwrite functions create-execution --function-id hodos-partner-stats"

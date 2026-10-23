#!/usr/bin/env bash
# Provision the Hodos backend on Appwrite (TablesDB).
#
# Creates the `hodos` database, the `events` and `hazards` tables, their
# columns, and indexes. Safe to re-run: every step uses --force and updates
# existing resources in place.
#
# Requires an authenticated Appwrite CLI linked to the target project
# (see appwrite.config.json).
set -uo pipefail

DATABASE_ID="hodos"

EVENT_COLUMNS=(
  '{"key":"deviceId","type":"string","size":64,"required":true}'
  '{"key":"tripId","type":"string","size":64,"required":true}'
  '{"key":"recordedAt","type":"datetime","required":true}'
  '{"key":"lat","type":"double","required":true}'
  '{"key":"lng","type":"double","required":true}'
  '{"key":"accuracy","type":"double","required":true}'
  '{"key":"speedKph","type":"double","required":true}'
  '{"key":"magnitude","type":"double","required":true}'
  '{"key":"severity","type":"integer","required":true}'
  '{"key":"kind","type":"enum","elements":["pothole","speed_bump","rough_pavement"],"required":true}'
)

HAZARD_COLUMNS=(
  '{"key":"hazardId","type":"string","size":64,"required":true}'
  '{"key":"lat","type":"double","required":true}'
  '{"key":"lng","type":"double","required":true}'
  '{"key":"kind","type":"enum","elements":["pothole","speed_bump","rough_pavement"],"required":true}'
  '{"key":"severity","type":"integer","required":true}'
  '{"key":"passCount","type":"integer","required":true}'
  '{"key":"deviceCount","type":"integer","required":true}'
  '{"key":"confidence","type":"double","required":true}'
  '{"key":"firstSeen","type":"datetime","required":true}'
  '{"key":"lastSeen","type":"datetime","required":true}'
  '{"key":"published","type":"boolean","required":true}'
  '{"key":"fixedVotes","type":"integer","default":0}'
)

to_args() {
  local flag="$1"
  shift
  local out=()
  local item
  for item in "$@"; do
    out+=("${flag}" "${item}")
  done
  printf '%s\0' "${out[@]}"
}

mapfile -d '' -t EVENT_COLUMN_ARGS < <(to_args --columns "${EVENT_COLUMNS[@]}")
mapfile -d '' -t HAZARD_COLUMN_ARGS < <(to_args --columns "${HAZARD_COLUMNS[@]}")

echo "== database: ${DATABASE_ID} =="
appwrite tablesdb create --database-id "${DATABASE_ID}" --name "Hodos" -f || true

echo "== table: events =="
appwrite tablesdb create-table \
  --database-id "${DATABASE_ID}" \
  --table-id events \
  --name "Events" \
  --permissions 'create("any")' \
  "${EVENT_COLUMN_ARGS[@]}" -f

echo "== table: hazards =="
appwrite tablesdb create-table \
  --database-id "${DATABASE_ID}" \
  --table-id hazards \
  --name "Hazards" \
  --permissions 'read("any")' \
  --indexes '{"key":"published","type":"key","attributes":["published"]}' \
  "${HAZARD_COLUMN_ARGS[@]}" -f

echo "== column: hazards.fixedVotes =="
appwrite tablesdb create-integer-column \
  --database-id "${DATABASE_ID}" \
  --table-id hazards \
  --key fixedVotes --required=false --xdefault 0 -f || true

echo "Done."

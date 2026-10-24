#!/usr/bin/env bash
# Provision the Hodos backend on Appwrite (TablesDB).
#
# Creates the `hodos` database, the `events`, `hazards` and `profiles` tables,
# their columns, indexes and permissions. Safe to re-run: table and column
# creation tolerates already-exists.
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
  '{"key":"confidence","type":"double","default":0}'
  '{"key":"mode","type":"enum","elements":["vehicle","pedestrian"]}'
  '{"key":"observation","type":"enum","elements":["impact","pass","fix"],"default":"impact"}'
  '{"key":"hazardRef","type":"string","size":64}'
)

HAZARD_COLUMNS=(
  '{"key":"hazardId","type":"string","size":64,"required":true}'
  '{"key":"lat","type":"double","required":true}'
  '{"key":"lng","type":"double","required":true}'
  '{"key":"kind","type":"enum","elements":["pothole","speed_bump","rough_pavement"],"required":true}'
  '{"key":"severity","type":"integer","required":true}'
  '{"key":"passCount","type":"integer","required":true}'
  '{"key":"deviceCount","type":"integer","required":true}'
  '{"key":"dayCount","type":"integer","default":0}'
  '{"key":"confidence","type":"double","required":true}'
  '{"key":"firstSeen","type":"datetime","required":true}'
  '{"key":"lastSeen","type":"datetime","required":true}'
  '{"key":"published","type":"boolean","required":true}'
  '{"key":"fixedVotes","type":"integer","default":0}'
  '{"key":"clearPasses","type":"integer","default":0}'
)

PROFILE_COLUMNS=(
  '{"key":"data","type":"longtext","required":true}'
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
mapfile -d '' -t PROFILE_COLUMN_ARGS < <(to_args --columns "${PROFILE_COLUMNS[@]}")

echo "== database: ${DATABASE_ID} =="
appwrite tablesdb create --database-id "${DATABASE_ID}" --name "Hodos" -f || true

echo "== table: events =="
appwrite tablesdb create-table \
  --database-id "${DATABASE_ID}" \
  --table-id events \
  --name "Events" \
  --permissions 'create("any")' \
  "${EVENT_COLUMN_ARGS[@]}" -f || true

echo "== table: hazards =="
appwrite tablesdb create-table \
  --database-id "${DATABASE_ID}" \
  --table-id hazards \
  --name "Hazards" \
  --permissions 'read("any")' 'create("any")' 'update("any")' \
  --indexes '{"key":"published","type":"key","attributes":["published"]}' \
  "${HAZARD_COLUMN_ARGS[@]}" -f || true

echo "== table: profiles (private per identity, row security) =="
appwrite tablesdb create-table \
  --database-id "${DATABASE_ID}" \
  --table-id profiles \
  --name "Profiles" \
  --row-security \
  --permissions 'create("users")' \
  "${PROFILE_COLUMN_ARGS[@]}" -f || true

echo "== columns added after first provisioning =="
appwrite tablesdb create-integer-column --database-id "${DATABASE_ID}" --table-id hazards \
  --key fixedVotes --required=false --xdefault 0 -f || true
appwrite tablesdb create-integer-column --database-id "${DATABASE_ID}" --table-id hazards \
  --key dayCount --required=false --xdefault 0 -f || true
appwrite tablesdb create-float-column --database-id "${DATABASE_ID}" --table-id events \
  --key confidence --required=false --xdefault 0 -f || true
appwrite tablesdb create-enum-column --database-id "${DATABASE_ID}" --table-id events \
  --key mode --elements vehicle --elements pedestrian --required=false -f || true
appwrite tablesdb create-integer-column --database-id "${DATABASE_ID}" --table-id hazards \
  --key clearPasses --required=false --xdefault 0 -f || true
appwrite tablesdb create-enum-column --database-id "${DATABASE_ID}" --table-id events \
  --key observation --elements impact --elements pass --elements fix --required=false -f || true
# Also migrate pre-existing tables; creation on an existing key is a no-op.
appwrite tablesdb update-enum-column --database-id "${DATABASE_ID}" --table-id events \
  --key observation --elements impact --elements pass --elements fix --required=false -f || true
appwrite tablesdb create-string-column --database-id "${DATABASE_ID}" --table-id events \
  --key hazardRef --size 64 --required=false -f || true

echo "Done."

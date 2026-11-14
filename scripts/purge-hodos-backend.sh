#!/usr/bin/env bash
# Purge Hodos road data from Appwrite, with a full backup first.
#
# Authenticate with either a server API key or the CLI login token:
#   export APPWRITE_API_KEY="standard_..."
#   # or, borrowing the session the Appwrite CLI already stored:
#   export APPWRITE_SESSION_TOKEN="$(jq -r '.current as $c | .[$c].accessToken' ~/.appwrite/prefs.json)"
#
# Run from anywhere:
#   ./scripts/purge-hodos-backend.sh            # backup + delete every table's rows
#   ./scripts/purge-hodos-backend.sh --backup   # backup only, delete nothing
#
# Everything is reversible from the JSON backup it writes to backups/.
set -euo pipefail

ENDPOINT="https://sgp.cloud.appwrite.io/v1"
PROJECT_ID="6ad7939a002ff135e419"
DATABASE_ID="hodos"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="${1:-purge}"

if [[ -z "${APPWRITE_API_KEY:-}" && -z "${APPWRITE_SESSION_TOKEN:-}" ]]; then
  echo "error: set APPWRITE_API_KEY (server key) or APPWRITE_SESSION_TOKEN (CLI login token)" >&2
  exit 1
fi

api() {
  local method="$1" path="$2"
  curl -sS -X "$method" "$ENDPOINT$path" \
    ${APPWRITE_API_KEY:+-H "X-Appwrite-Key: $APPWRITE_API_KEY"} \
    ${APPWRITE_SESSION_TOKEN:+-H "Authorization: Bearer $APPWRITE_SESSION_TOKEN"} \
    -H "X-Appwrite-Project: $PROJECT_ID" \
    -H "Content-Type: application/json"
}

# Paginate with the modern queries[] form: plain limit/offset query params are
# ignored by the tables API, which silently returns the first page forever.
rows_page() {
  local table="$1" offset="$2"
  local q_limit q_offset
  q_limit='{"method":"limit","values":[100]}'
  q_offset="{\"method\":\"offset\",\"values\":[$offset]}"
  api GET "/tablesdb/$DATABASE_ID/tables/$table/rows?queries[]=$(printf %s "$q_limit" | jq -sRr @uri)&queries[]=$(printf %s "$q_offset" | jq -sRr @uri)"
}

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/hodos-backup-$STAMP.json"
echo "[]" > "$BACKUP_FILE"

TABLES_JSON="$(api GET "/tablesdb/$DATABASE_ID/tables?limit=200")"
if ! echo "$TABLES_JSON" | jq -e '.tables' >/dev/null 2>&1; then
  echo "error: could not list tables — check the API key and database id" >&2
  echo "$TABLES_JSON" | head -c 500 >&2
  exit 1
fi

TABLE_IDS=$(echo "$TABLES_JSON" | jq -r '.tables[]["$id"]')
if [[ -z "$TABLE_IDS" ]]; then
  echo "No tables found in database '$DATABASE_ID'."
  exit 0
fi

echo "Database: $DATABASE_ID"
echo "Backup:   $BACKUP_FILE"
echo

for TABLE in $TABLE_IDS; do
  echo "→ $TABLE"
  OFFSET=0
  COUNT=0
  : > "$BACKUP_DIR/.$TABLE.part"
  while :; do
    PAGE=$(rows_page "$TABLE" "$OFFSET")
    N=$(echo "$PAGE" | jq '.rows | length' 2>/dev/null || echo 0)
    [[ "$N" -eq 0 ]] && break
    echo "$PAGE" | jq -c '.rows[]' >> "$BACKUP_DIR/.$TABLE.part"
    COUNT=$((COUNT + N))
    OFFSET=$((OFFSET + N))
    [[ "$N" -lt 100 ]] && break
  done

  if [[ -s "$BACKUP_DIR/.$TABLE.part" ]]; then
    jq --arg table "$TABLE" --slurpfile rows "$BACKUP_DIR/.$TABLE.part" \
      '. + [{table: $table, rows: $rows}]' "$BACKUP_FILE" > "$BACKUP_FILE.tmp" \
      && mv "$BACKUP_FILE.tmp" "$BACKUP_FILE"
  fi
  echo "  backed up $COUNT row(s)"

  if [[ "$MODE" != "--backup" ]]; then
    IDS=$(jq -r '.["$id"]?' "$BACKUP_DIR/.$TABLE.part" 2>/dev/null || true)
    DELETED=0
    while IFS= read -r ROW_ID; do
      [[ -z "$ROW_ID" ]] && continue
      api DELETE "/tablesdb/$DATABASE_ID/tables/$TABLE/rows/$ROW_ID" >/dev/null || true
      DELETED=$((DELETED + 1))
    done <<< "$IDS"
    echo "  deleted $DELETED row(s)"
  fi
  rm -f "$BACKUP_DIR/.$TABLE.part"
done

echo
if [[ "$MODE" == "--backup" ]]; then
  echo "Backup-only mode: nothing was deleted."
else
  echo "Verifying counts..."
  for TABLE in $TABLE_IDS; do
    REMAIN=$(rows_page "$TABLE" 0 | jq '.total // (.rows | length)')
    echo "  $TABLE: $REMAIN remaining"
  done
fi
echo
echo "Done. Backup written to: $BACKUP_FILE"

#!/usr/bin/env bash
# Activate (or close) a shop placement once its payment has cleared.
#
#   scripts/activate-placement.sh <placement-id>
#   scripts/activate-placement.sh <placement-id> --close
#
# Reads the order from partnerPlacements, writes a live pin into `partners`
# with an expiry of now + days, and marks the order active. Closing removes the
# pin early. Run this after a Payoneer, card or PayPal reference clears; there is
# deliberately no automatic path because settlement is manual today.
set -euo pipefail
cd "$(dirname "$0")/.."

ID="${1:-}"
MODE="${2:-}"
DB="${HODOS_DB:-hodos}"
ENDPOINT="${HODOS_ENDPOINT:-https://sgp.cloud.appwrite.io/v1}"
PROJECT="${HODOS_PROJECT_ID:-6ad7939a002ff135e419}"

if [[ -z "$ID" ]]; then
  echo "usage: scripts/activate-placement.sh <placement-id> [--close]" >&2
  exit 1
fi

appwrite client -e "$ENDPOINT" -p "$PROJECT" >/dev/null

row="$(appwrite tablesdb get-row --database-id "$DB" --table-id partnerPlacements --row-id "$ID" -j 2>/dev/null || true)"
if [[ -z "$row" ]]; then
  echo "error: no placement '$ID'" >&2
  exit 1
fi

status="$(echo "$row" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write(String(r.status||"?"))})')"
name="$(echo "$row" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write(String(r.name||""))})')"
if [[ "$status" == "active" && "$MODE" != "--close" ]]; then
  echo "Placement $ID ($name) is already active."
  exit 0
fi

if [[ "$MODE" == "--close" ]]; then
  appwrite tablesdb update-row --database-id "$DB" --table-id partnerPlacements --row-id "$ID" \
    --data '{"status":"closed"}' >/dev/null
  echo "Closed order $ID."
  # The pin itself is left in place until it expires; expire it now instead.
  appwrite tablesdb delete-row --database-id "$DB" --table-id partners --row-id "$ID" >/dev/null 2>&1 || true
  echo "Pin removed."
  exit 0
fi

appwrite tablesdb update-row --database-id "$DB" --table-id partnerPlacements --row-id "$ID" \
  --data '{"status":"active"}' >/dev/null

payload="$(echo "$row" | node -e '
let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s);
  const days = Math.max(1, Number(r.days)||1);
  const until = new Date(Date.now() + days*86400000).toISOString();
  process.stdout.write(JSON.stringify({
    id: r.$id,
    data: JSON.stringify({
      name: r.name,
      category: r.category || "pit-stop",
      lat: r.lat,
      lng: r.lng,
      offer: r.offer || "",
      sponsorLabel: "Local shop",
      activeUntil: until
    }),
    until
  }));
})')"

data="$(echo "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).data))')"
until="$(echo "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).until))')"

appwrite tablesdb create-row --database-id "$DB" --table-id partners --row-id "$ID" \
  --data "$data" >/dev/null 2>&1 || \
appwrite tablesdb update-row --database-id "$DB" --table-id partners --row-id "$ID" \
  --data "$data" >/dev/null

echo "Live: $name"
echo "  pin id:  $ID"
echo "  expires: $until"
echo "It disappears from the map on its own at expiry."

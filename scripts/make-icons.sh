#!/usr/bin/env bash
# Generate every icon and splash asset Hodos ships, from brand/icon.svg.
#
# Rendering goes through headless Chromium so the gradients and strokes are
# composited properly; ImageMagick then resamples to the target sizes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="$ROOT/brand"
WEB="$ROOT/apps/web/public"
ANDROID="$ROOT/apps/web/android/app/src/main/res"

CHROME="chromium --headless=new --disable-gpu --no-sandbox --hide-scrollbars"
CHROME="$CHROME --allow-file-access-from-files --default-background-color=00000000"

render() {
  local mode="$1" size="$2" out="$3"
  mkdir -p "$(dirname "$out")"
  $CHROME --screenshot="$out" --window-size="$size,$size" \
    "file://$BRAND/render.html?mode=$mode&s=$size" >/dev/null 2>&1
}

echo "== web =="
render tile 512 "$WEB/icon-512.png"
render tile 192 "$WEB/icon-192.png"
render tile 180 "$WEB/apple-touch-icon.png"
render tile 32 "$WEB/favicon-32.png"
render tile 16 "$WEB/favicon-16.png"
render square 512 "$WEB/icon-maskable-512.png"
magick "$WEB/favicon-16.png" "$WEB/favicon-32.png" -define icon:auto-resize=48,32,16 "$WEB/favicon.ico"
cp "$BRAND/icon.svg" "$WEB/icon.svg"
ls -la "$WEB" | grep -E 'icon|favicon|apple'

echo "== android launcher =="
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  density="${pair%%:*}"
  size="${pair##*:}"
  foreground=$((size * 108 / 48))
  render tile "$size" "$ANDROID/mipmap-$density/ic_launcher.png"
  render tile "$size" "$ANDROID/mipmap-$density/ic_launcher_round.png"
  render glyph "$foreground" "$ANDROID/mipmap-$density/ic_launcher_foreground.png"
  echo "  mipmap-$density: ${size}px launcher, ${foreground}px foreground"
done

mkdir -p "$ANDROID/mipmap-anydpi-v26"
for name in ic_launcher ic_launcher_round; do
  cat >"$ANDROID/mipmap-anydpi-v26/$name.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
XML
done

mkdir -p "$ANDROID/values"
cat >"$ANDROID/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0a0e13</color>
</resources>
XML

echo "== splash =="
render splash 1024 "$ANDROID/drawable/splash.png"
for pair in mdpi:256 hdpi:384 xhdpi:512 xxhdpi:768 xxxhdpi:1024; do
  density="${pair%%:*}"
  size="${pair##*:}"
  render splash "$size" "$ANDROID/drawable-$density/splash.png"
done

echo "done"

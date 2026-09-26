#!/usr/bin/env bash
# Dev-only: regenerate the committed PNG app icons.
# Requires ImageMagick 7 (`magick`). Run from anywhere:
#   bash scripts/make-icons.sh
# Afterwards run `node scripts/update-sw-version.mjs` (the icons are precached).
#
# icons/icon.svg is the source artwork (512x512 design grid). ImageMagick's
# built-in SVG renderer (MSVG) drops strokes on some builds and rsvg-convert is
# not always installed, so this script draws the same geometry with MVG
# primitives instead. If you change icon.svg, mirror the change below.
#
# All artwork (ship, crystal, rock) stays inside the central 80% circle
# (radius 204.8 around 256,256), so the same art is safe as a maskable icon.
# Outputs are opaque (Apple touch icons must not be transparent) and stripped
# of metadata/timestamps so re-runs are byte-stable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/icons"
BG="#050510"
SS=4                       # supersample factor (draw at 2048, then downscale)
BIG=$((512 * SS))

command -v magick >/dev/null 2>&1 || { echo "ImageMagick 'magick' not found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MVG="$TMP/icon.mvg"

cat > "$MVG" <<MVG
push graphic-context
scale $SS,$SS
stroke none
fill #ffffff
fill-opacity 0.7
circle 40,60 43,60
circle 470,40 472.5,40
circle 90,300 92.5,300
circle 450,300 453,300
circle 60,460 62.5,460
circle 300,470 302,470
circle 250,40 252,40
circle 200,420 202.5,420
circle 420,440 423,440
circle 160,80 162,80
fill-opacity 1
stroke-linejoin round
stroke-linecap round
fill rgba(0,180,0,0.35)
stroke #00ff00
stroke-width 8
polygon 145,122 176,152 162,204 128,204 114,152
fill none
stroke-width 5
polyline 114,152 145,166 176,152
line 145,166 145,204
fill rgba(100,0,0,0.6)
stroke #cc0000
stroke-width 6
polygon 366.0,126.0 373.3,141.1 388.7,130.7 384.9,149.6 402.4,149.4 389.8,162.6 407.6,172.0 391.5,177.6 396.2,192.2 380.6,188.7 377.8,206.3 366.0,192.0 354.7,204.4 352.5,187.0 334.3,193.5 344.2,176.0 326.4,171.7 338.3,162.0 327.8,148.6 345.6,148.3 344.4,132.3 358.7,141.1
fill none
stroke #ffffff
stroke-width 14
polygon 256,120 339.6,349.6 172.4,349.6
pop graphic-context
MVG

magick -size "${BIG}x${BIG}" "xc:$BG" -draw "@$MVG" "$TMP/master.png"

render() {
  local size="$1" name="$2"
  magick "$TMP/master.png" -filter Lanczos -resize "${size}x${size}" \
    -alpha off -strip -define png:exclude-chunks=date,time \
    "PNG24:$OUT/$name"
  echo "wrote icons/$name (${size}x${size})"
}

render 192 icon-192.png
render 512 icon-512.png
render 512 icon-maskable-512.png
render 180 apple-touch-icon-180.png
render 32  favicon-32.png

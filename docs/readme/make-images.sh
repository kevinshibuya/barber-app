#!/usr/bin/env bash
# Builds the README's images in docs/readme/ from the screenshots and contact
# sheets already in the repo. Needs ffmpeg and cwebp. Re-running overwrites.
#   docs/readme/make-images.sh
#
# Sources:
#   docs/release/screenshots/  taken by hand on an Android emulator during the
#                              release walkthrough (docs/release.md); to retake
#                              one, follow that walkthrough and replace the file.
#   docs/bakeoff/results/      written by the bake-off
#                              (`pnpm --filter @barber/worker run bakeoff`).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/docs/readme"
shots="$root/docs/release/screenshots"
sheets="$root/docs/bakeoff/results"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# <source> <name> [ffmpeg filter]: one WebP at quality 82.
webp() {
  local src="$1" name="$2" filter="${3:-null}"
  ffmpeg -v error -y -i "$src" -vf "$filter" "$scratch/$name.png"
  cwebp -quiet -q 82 "$scratch/$name.png" -o "$out/$name.webp"
}

# Phone frames: the emulator's 540x1200 screens, kept at their size.
webp "$shots/17-picker-hair-fixed.jpg" picker-hair
webp "$shots/05-consent.jpg" consent
webp "$shots/08-front-uploaded.jpg" photo-slots
webp "$shots/19-picker-beard-fixed.jpg" picker-beard
webp "$shots/12-finish.jpg" finish
webp "$shots/03-dashboard.jpg" dashboard
# The client page is a desktop browser capture: crop to its one column.
webp "$shots/16-client-page.jpg" client-page "crop=660:976:270:0"

# Bake-off contact sheets: rows are photos, columns are hair styles.
webp "$sheets/contact-nano-banana-2.1.jpg" bakeoff-nano-banana "scale=1600:-1"
webp "$sheets/contact-flux-klein.jpg" bakeoff-flux-klein "scale=1600:-1"

ls -l "$out"/*.webp

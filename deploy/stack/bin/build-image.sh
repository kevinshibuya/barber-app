#!/usr/bin/env bash
# Builds barber-worker:<tag> for linux/arm64 on the Mac, from the repo root.
# The tag is the short HEAD SHA, so the tree must be clean.
#   deploy/stack/bin/build-image.sh [--allow-dirty]
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
if [[ "${1:-}" != --allow-dirty && -n "$(git -C "$root" status --porcelain)" ]]; then
  echo "the tree is dirty: commit first, or pass --allow-dirty" >&2
  exit 1
fi
tag="$(git -C "$root" rev-parse --short HEAD)"
docker build --platform linux/arm64 -f "$root/apps/worker/Dockerfile" -t "barber-worker:$tag" "$root"
echo "$tag"

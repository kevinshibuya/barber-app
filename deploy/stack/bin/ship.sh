#!/usr/bin/env bash
# Ships a release from the Mac to the box: this directory's files to
# ~/apps/barber-worker/ and the image into the box's Docker, over SSH. No registry.
#   BOX=ubuntu@<box-ip> deploy/stack/bin/ship.sh <tag>
# The IP is in ts6-server's README, never in this repo. SSH_KEY defaults to
# ~/.ssh/ts6_oracle.
set -euo pipefail

tag="${1:?usage: BOX=ubuntu@<box-ip> deploy/stack/bin/ship.sh <tag>}"
box="${BOX:?set BOX=ubuntu@<box-ip>, the IP is in the README of ts6-server}"
key="${SSH_KEY:-$HOME/.ssh/ts6_oracle}"
here="$(cd "$(dirname "$0")/.." && pwd)"
image="barber-worker:$tag"
docker image inspect "$image" >/dev/null 2>&1 || { echo "missing $image: run bin/build-image.sh first" >&2; exit 1; }

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$here" --exclude .env -czf "$scratch/files.tgz" .
docker save "$image" | gzip > "$scratch/image.tgz"

ssh -i "$key" "$box" 'mkdir -p ~/apps/barber-worker && tar -C ~/apps/barber-worker -xzf -' < "$scratch/files.tgz"
scp -q -i "$key" "$scratch/image.tgz" "$box:/tmp/barber-worker-$tag.tgz"
ssh -i "$key" "$box" "gunzip -c /tmp/barber-worker-$tag.tgz | sudo docker load && rm /tmp/barber-worker-$tag.tgz"

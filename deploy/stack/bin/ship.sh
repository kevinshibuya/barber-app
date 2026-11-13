#!/usr/bin/env bash
# Ships a release from the build machine to the server: this directory's files
# to ~/apps/barber-worker/ and the image into the server's Docker, over SSH. No
# registry.
#   BOX=<user>@<host> SSH_KEY=<path to private key> deploy/stack/bin/ship.sh <tag>
# Neither value lives in this repo.
set -euo pipefail

tag="${1:?usage: BOX=<user>@<host> SSH_KEY=<key path> deploy/stack/bin/ship.sh <tag>}"
box="${BOX:?set BOX=<user>@<host>, the server to ship to}"
key="${SSH_KEY:?set SSH_KEY to the private key that logs in to BOX}"
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

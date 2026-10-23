#!/usr/bin/env bash
# On the box, from ~/apps/barber-worker: points .env at <tag>, starts it, waits
# for it to be healthy, then removes every barber-worker tag that is neither
# current nor previous. Running it twice with one tag changes nothing.
#   bash bin/deploy.sh <tag>
# Never prune images on the box: the shared build cache holds SinusBot's layers.
set -euo pipefail

tag="${1:?usage: bash bin/deploy.sh <tag>}"
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env is missing: copy .env.example and fill it in" >&2; exit 1; }

current="$(grep '^IMAGE_TAG=' .env | cut -d= -f2)"
if [[ "$current" != "$tag" ]]; then
  sed -i "s/^PREVIOUS_IMAGE_TAG=.*/PREVIOUS_IMAGE_TAG=$current/; s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" .env
fi
sudo docker compose up -d --remove-orphans

for _ in $(seq 1 30); do
  state="$(sudo docker inspect -f '{{.State.Health.Status}}' "$(sudo docker compose ps -q worker)")"
  [[ "$state" == healthy ]] && break
  sleep 2
done
sudo docker compose ps
[[ "$state" == healthy ]] || { echo "worker is $state after 60 s" >&2; exit 1; }

previous="$(grep '^PREVIOUS_IMAGE_TAG=' .env | cut -d= -f2)"
sudo docker images barber-worker --format '{{.Tag}}' | while read -r old; do
  [[ "$old" == "$tag" || "$old" == "$previous" ]] || sudo docker rmi "barber-worker:$old"
done

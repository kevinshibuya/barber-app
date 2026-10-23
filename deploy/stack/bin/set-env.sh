#!/usr/bin/env bash
# Sets one variable in the box's ~/apps/barber-worker/.env from stdin, so a
# secret never lands in argv, shell history or a chat:
#   pbpaste | BOX=ubuntu@<box-ip> deploy/stack/bin/set-env.sh GEMINI_API_KEY
# The first run creates .env from .env.example, mode 600. A running worker is
# recreated so it reads the new value.
set -euo pipefail

name="${1:?usage: pbpaste | BOX=ubuntu@<box-ip> deploy/stack/bin/set-env.sh <NAME>}"
[[ $name =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "not a variable name: $name" >&2; exit 2; }
box="${BOX:?set BOX=ubuntu@<box-ip>, the IP is in the README of the server repo}"
key="${SSH_KEY:-$HOME/.ssh/deploy_key}"
value="$(cat)"
[[ -n $value ]] || { echo "nothing on stdin" >&2; exit 1; }
[[ $value != *$'\n'* ]] || { echo "the value spans lines" >&2; exit 1; }

# The value travels on ssh's stdin and reaches awk through its environment.
read -r -d '' remote <<'REMOTE' || true
set -euo pipefail
name=$1
cd ~/apps/barber-worker
umask 077
[[ -f .env ]] || cp .env.example .env
chmod 600 .env
V="$(cat)"
export V
awk -v n="$name" '
  BEGIN { v = ENVIRON["V"] }
  index($0, n "=") == 1 { print n "=" v; done = 1; next }
  { print }
  END { if (!done) print n "=" v }
' .env > .env.next
cat .env.next > .env
rm .env.next
echo "$name set (${#V} characters)"
if [[ -n "$(sudo docker compose ps -q worker 2>/dev/null)" ]]; then sudo docker compose up -d worker; fi
REMOTE
printf '%s' "$value" | ssh -i "$key" "$box" "bash -c $(printf '%q' "$remote") _ $name"

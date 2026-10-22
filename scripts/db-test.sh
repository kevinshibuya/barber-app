#!/usr/bin/env bash
# Usage: scripts/db-test.sh <package filter> <script> [args...]
#
# Runs `pnpm --filter <filter> run <script> args...` against the local
# Supabase, under the machine-wide database lock, so two worktrees never run
# database tests at once. Every database-touching gate goes through here.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/db.sh"

if [ $# -lt 2 ]; then
  echo "usage: scripts/db-test.sh <package filter> <script> [args...]" >&2
  exit 64
fi
filter="$1"
script="$2"
shift 2

db_require pnpm
db_lock_acquire
db_up

api_url="" anon_key="" service_role_key="" db_url=""
while IFS='=' read -r key value; do
  value="${value#\"}"
  value="${value%\"}"
  case "$key" in
    API_URL) api_url="$value" ;;
    ANON_KEY) anon_key="$value" ;;
    SERVICE_ROLE_KEY) service_role_key="$value" ;;
    DB_URL) db_url="$value" ;;
  esac
done < <(supabase status -o env 2>/dev/null)

for name in api_url anon_key service_role_key db_url; do
  if [ -z "${!name}" ]; then
    echo "db-test: supabase status gave no ${name}" >&2
    exit 1
  fi
done

# The names the packages read; @barber/shared's GATE_ENV lists them.
export SUPABASE_URL="$api_url"
export SUPABASE_ANON_KEY="$anon_key"
export SUPABASE_SERVICE_ROLE_KEY="$service_role_key"
export DATABASE_URL="$db_url"
export EXPO_PUBLIC_SUPABASE_URL="$api_url"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$anon_key"

cd "$REPO_ROOT"
pnpm --filter "$filter" run "$script" "$@"

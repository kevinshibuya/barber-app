# Shared by scripts/db-up.sh and scripts/db-test.sh. Source it; do not run it.
#
# One local Supabase serves every worktree on the machine, so every gate that
# touches it runs under one machine-wide lock. macOS has no flock: the lock is
# a directory (mkdir is atomic) holding the owner's pid. A lock whose owner is
# dead, or that is older than BARBER_DB_LOCK_STALE_SECONDS, is taken over.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BARBER_DB_LOCK_DIR="${BARBER_DB_LOCK_DIR:-/tmp/barber-app-db.lock}"
BARBER_DB_LOCK_STALE_SECONDS="${BARBER_DB_LOCK_STALE_SECONDS:-1800}"
# A lock directory without an owner file is younger than this, or abandoned.
BARBER_DB_LOCK_GRACE_SECONDS=10

db_require() {
  local tool
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "db: $tool is not on PATH" >&2
      exit 127
    fi
  done
}

db_lock_age() {
  local mtime
  mtime="$(stat -f %m "$BARBER_DB_LOCK_DIR" 2>/dev/null || stat -c %Y "$BARBER_DB_LOCK_DIR" 2>/dev/null)" || return 1
  echo $(($(date +%s) - mtime))
}

# Prints why the current lock is stale, or fails when it is live.
db_lock_stale_reason() {
  local age pid
  age="$(db_lock_age)" || { echo "it vanished"; return 0; }
  if [ ! -f "$BARBER_DB_LOCK_DIR/owner" ]; then
    [ "$age" -gt "$BARBER_DB_LOCK_GRACE_SECONDS" ] && { echo "it has no owner"; return 0; }
    return 1
  fi
  pid="$(cut -d' ' -f1 "$BARBER_DB_LOCK_DIR/owner" 2>/dev/null)"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "its owner (pid $pid) is gone"
    return 0
  fi
  if [ "$age" -gt "$BARBER_DB_LOCK_STALE_SECONDS" ]; then
    echo "it is ${age}s old"
    return 0
  fi
  return 1
}

db_lock_release() {
  if [ "${DB_LOCK_HELD:-}" = 1 ] && [ "$(cut -d' ' -f1 "$BARBER_DB_LOCK_DIR/owner" 2>/dev/null)" = "$$" ]; then
    rm -rf "$BARBER_DB_LOCK_DIR"
  fi
  DB_LOCK_HELD=0
}

# Takes the lock and releases it when the calling script exits, however it exits.
db_lock_acquire() {
  local reason announced=0
  while ! mkdir "$BARBER_DB_LOCK_DIR" 2>/dev/null; do
    if reason="$(db_lock_stale_reason)"; then
      echo "db lock: taking over $BARBER_DB_LOCK_DIR because $reason" >&2
      rm -rf "$BARBER_DB_LOCK_DIR"
      continue
    fi
    if [ "$announced" = 0 ]; then
      echo "db lock: waiting for $(cat "$BARBER_DB_LOCK_DIR/owner" 2>/dev/null || echo 'another run')" >&2
      announced=1
    fi
    sleep 2
  done
  echo "$$ $REPO_ROOT $(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$BARBER_DB_LOCK_DIR/owner"
  DB_LOCK_HELD=1
  trap db_lock_release EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# Starts the local Supabase when it is down and applies pending migrations.
# Never resets the database: other worktrees' test data lives there too.
db_up() {
  db_require supabase docker
  cd "$REPO_ROOT"
  if ! supabase status >/dev/null 2>&1; then
    supabase start
  fi
  supabase migration up --include-all --local
}

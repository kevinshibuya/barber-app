#!/usr/bin/env bash
# Starts the machine's local Supabase if it is down and applies this
# worktree's migrations, under the machine-wide database lock. Idempotent.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/db.sh"

db_lock_acquire
db_up

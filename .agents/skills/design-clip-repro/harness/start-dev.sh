#!/usr/bin/env bash
# Local only: boots this worktree's Design dev server on its own port and
# database (see harness-env.mjs). Exits happily if its server already runs.
# A Fusion branch runs its dev server already, on 8080.
set -euo pipefail
cd "$(dirname "$0")"
{ read -r PORT; read -r PGLITE; read -r WORKTREE; } < <(node -e '
  import("./harness-env.mjs").then((m) => {
    console.log([m.PORT, m.PGLITE, m.WORKTREE].join("\n"));
    process.exit(0);
  })')
PIN="$WORKTREE/templates/design/.tmp/parity/.port"
answers() { curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$1/"; }

if answers "$PORT"; then
  if [ "$(cat "$PIN" 2>/dev/null)" = "$PORT" ]; then
    echo "already up on $PORT"; exit 0
  fi
  # The port comes from a hash of the path, so another worktree's server can hold it.
  while answers "$PORT"; do PORT=$((PORT + 1)); done
fi
mkdir -p "$(dirname "$PIN")"
echo "$PORT" > "$PIN"

echo "starting the design dev server on $PORT (db: ${PGLITE##*/})"
cd "$WORKTREE/templates/design"
PORT="$PORT" DATABASE_URL="$PGLITE" pnpm dev > "/tmp/design-dev-$PORT.log" 2>&1 &
for _ in $(seq 1 30); do
  answers "$PORT" && { echo "up on $PORT"; exit 0; }
  sleep 4
done
echo "FAILED to come up; see /tmp/design-dev-$PORT.log" >&2; exit 1

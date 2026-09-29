#!/usr/bin/env bash
# Local only: boots this worktree's Design dev server on its own port and
# database (see harness-env.mjs). Exits happily if the port already serves.
# A Fusion branch runs its dev server already, on 8080.
set -euo pipefail
cd "$(dirname "$0")"
eval "$(node -e '
  import("./harness-env.mjs").then((m) => {
    console.log(`PORT=${m.PORT}; PGLITE="${m.PGLITE}"; WORKTREE="${m.WORKTREE}"`);
    process.exit(0);
  })')"
if curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/"; then
  echo "already up on $PORT"; exit 0
fi
echo "starting the design dev server on $PORT (db: ${PGLITE##*/})"
cd "$WORKTREE/templates/design"
PORT="$PORT" DATABASE_URL="$PGLITE" pnpm dev > "/tmp/design-dev-$PORT.log" 2>&1 &
for _ in $(seq 1 30); do
  curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/" && { echo "up on $PORT"; exit 0; }
  sleep 4
done
echo "FAILED to come up; see /tmp/design-dev-$PORT.log" >&2; exit 1

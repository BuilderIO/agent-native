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
ready() {
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1/home") || return 1
  [ "$status" = "200" ]
}

# The pin holds "<port> <pid>" of the server this script started.
PIN_PORT="" PIN_PID=""
[ -f "$PIN" ] && read -r PIN_PORT PIN_PID < "$PIN" || true
if [ "$PIN_PORT" = "$PORT" ] && kill -0 "${PIN_PID:-0}" 2>/dev/null; then
  for _ in $(seq 1 60); do
    kill -0 "$PIN_PID" 2>/dev/null || break
    ready "$PORT" && { echo "already up on $PORT"; exit 0; }
    sleep 4
  done
  echo "FAILED: pinned server on $PORT did not become ready; see /tmp/design-dev-$PORT.log" >&2
  exit 1
fi
if answers "$PORT"; then
  # The port comes from a hash of the path, so another worktree's server can hold it.
  while answers "$PORT"; do PORT=$((PORT + 1)); done
fi

echo "starting the design dev server on $PORT (db: ${PGLITE##*/})"
mkdir -p "$(dirname "$PIN")"
cd "$WORKTREE/templates/design"
# Its own process group, so a failed start can stop pnpm and everything it spawned.
set -m
PORT="$PORT" DATABASE_URL="$PGLITE" pnpm dev > "/tmp/design-dev-$PORT.log" 2>&1 &
DEV_PID=$!
set +m
echo "$PORT $DEV_PID" > "$PIN"
for _ in $(seq 1 60); do
  kill -0 "$DEV_PID" 2>/dev/null || break
  ready "$PORT" && { echo "up on $PORT"; exit 0; }
  sleep 4
done
kill -- "-$DEV_PID" 2>/dev/null || true
rm -f "$PIN"
echo "FAILED to come up; see /tmp/design-dev-$PORT.log" >&2; exit 1

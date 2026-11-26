#!/usr/bin/env bash
# Makes a new git worktree ready to run: `pnpm install` plus the main checkout's ignored .env files.
# Usage: worktree-setup.sh [--hook]. With --hook, failures are reported on stdout with exit 0.
set -Eeuo pipefail

hook=no
if [ "${1:-}" = --hook ]; then hook=yes; shift; fi
exec 3>&1
fail() { # a Claude SessionStart hook only shows the agent stdout from a run that exits 0
  echo "worktree-setup: $*" >&3
  [ "$hook" = yes ] && exit 0
  exit 1
}

wt=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$wt"
git_dir=$(git rev-parse --path-format=absolute --git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
[ "$git_dir" = "$common_dir" ] && exit 0 # main checkout or a plain clone: nothing to do

state_file="$git_dir/worktree-setup.state" # per-worktree, outside the tree
log="$git_dir/worktree-setup.log"
state=$(cat "$state_file" 2>/dev/null || true)
[ "$state" = "done" ] && exit 0
if [ -L node_modules ]; then
  echo "worktree-setup: node_modules is a symlink, leaving it alone (it resolves workspace code from the checkout it points to)"
  exit 0
fi
if [ -e node_modules ] && [ -z "$state" ]; then exit 0; fi # installed some other way
for tool in node pnpm; do
  command -v "$tool" >/dev/null || fail "$tool isn't on PATH; install dependencies yourself, or rerun bash $0 from a shell that has it"
done

lock="$git_dir/worktree-setup.lock" # a symlink to the owner's pid, created atomically
lock_owner() { readlink "$lock" 2>/dev/null; }
until ln -s "$$" "$lock" 2>/dev/null; do
  owner=$(lock_owner) || continue
  if kill -0 "$owner" 2>/dev/null; then
    echo "worktree-setup: waiting for the setup already running in this worktree (see $log)"
    while [ "$(lock_owner)" = "$owner" ] && kill -0 "$owner" 2>/dev/null; do sleep 5; done
  elif mkdir "$lock.reclaim" 2>/dev/null; then # one run at a time may remove a dead owner's lock
    if [ "$(lock_owner)" = "$owner" ]; then rm -f "$lock"; fi
    rmdir "$lock.reclaim"
  else
    find "$lock.reclaim" -maxdepth 0 -mmin +1 -exec rmdir {} + 2>/dev/null || true
    sleep 1
  fi
done
trap 'rm -f "$lock"' EXIT
state=$(cat "$state_file" 2>/dev/null || true)
[ "$state" = "done" ] && exit 0

src=${CODEX_SOURCE_TREE_PATH:-$(git worktree list --porcelain | sed -n '1s/^worktree //p')}
start=$SECONDS
exec >>"$log" 2>&1 # keep install output out of the agent's context; the summary goes to fd 3
trap 'fail "setup stopped at line $LINENO; see $log"' ERR
echo "=== $(date) setting up $wt from $src (previous state: ${state:-none})"

workspace_dirs() {
  echo .
  sed -n '/^packages:/,/^[^ -]/p' pnpm-workspace.yaml | sed -n "s/^ *- *['\"]\{0,1\}\([^'\"!]*\)['\"]\{0,1\} *$/\1/p" |
    while read -r pattern; do for d in $pattern; do if [ -f "$d/package.json" ]; then echo "$d"; fi; done; done
}

# Ignored env files the main checkout has and a fresh worktree lacks.
while read -r d; do
  for f in "$d/.env" "$d/.env.local"; do
    if [ -f "$src/$f" ] && [ ! -e "$wt/$f" ]; then cp -p "$src/$f" "$wt/$f"; fi
  done
done < <(workspace_dirs)

echo installing >"$state_file"
pnpm install --frozen-lockfile --prefer-offline ||
  fail "pnpm install failed after $((SECONDS - start))s; see $log, fix, then rerun bash $0"
echo "done" >"$state_file"
echo "worktree-setup: dependencies ready in $((SECONDS - start))s (log: $log)" >&3

#!/usr/bin/env bash
# Makes a new git worktree ready to run: clones the main checkout's dependencies copy-on-write where the package manager doesn't share them already, then installs.
set -euo pipefail

wt=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$wt"
git_dir=$(git rev-parse --path-format=absolute --git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
[ "$git_dir" = "$common_dir" ] && exit 0 # main checkout or a plain clone: nothing to do

if [ -f pnpm-lock.yaml ]; then pm=pnpm; elif [ -f package-lock.json ]; then pm=npm; else exit 0; fi
state_file="$git_dir/worktree-setup.state" # per-worktree, outside the tree
log="$git_dir/worktree-setup.log"
state=$(cat "$state_file" 2>/dev/null || true)
[ "$state" = "done" ] && exit 0
if [ -L node_modules ]; then
  echo "worktree-setup: node_modules is a symlink, leaving it alone (it resolves workspace code from the checkout it points to)" >&2
  exit 0
fi
if [ -e node_modules ] && [ -z "$state" ]; then exit 0; fi # installed some other way
for tool in node "$pm"; do
  if ! command -v "$tool" >/dev/null; then
    echo "worktree-setup: $tool isn't on PATH; install dependencies yourself or rerun bash scripts/worktree-setup.sh from a shell that has it" >&2
    exit 0
  fi
done

lock="$git_dir/worktree-setup.lock"
if ! mkdir "$lock" 2>/dev/null; then
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    rmdir "$lock" && mkdir "$lock"
  else
    echo "worktree-setup: waiting for the setup already running in this worktree (see $log)" >&2
    while [ -d "$lock" ] && [ -z "$(find "$lock" -maxdepth 0 -mmin +30 2>/dev/null)" ]; do sleep 5; done
    [ "$(cat "$state_file" 2>/dev/null)" = "done" ] && exit 0
    echo "worktree-setup: the other setup run didn't finish; see $log, then rerun bash scripts/worktree-setup.sh" >&2
    exit 1
  fi
fi
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

src=${CODEX_SOURCE_TREE_PATH:-$(git worktree list --porcelain | sed -n '1s/^worktree //p')}
start=$SECONDS
exec 3>&1 >>"$log" 2>&1 # keep install output out of the agent's context; summary goes to fd 3
echo "=== $(date) setting up $wt from $src with $pm (previous state: ${state:-none})"

workspace_dirs() {
  echo .
  if [ "$pm" = pnpm ]; then
    sed -n '/^packages:/,/^[^ -]/p' pnpm-workspace.yaml | sed -n "s/^ *- *['\"]\{0,1\}\([^'\"!]*\)['\"]\{0,1\} *$/\1/p"
  else
    node -e 'const w = require("./package.json").workspaces || []; for (const p of Array.isArray(w) ? w : w.packages || []) console.log(p)'
  fi | while read -r pattern; do for d in $pattern; do [ -f "$d/package.json" ] && echo "$d"; done; done
}

same_apfs_volume() { # macOS cp -c silently makes a full copy unless both trees sit on one APFS volume
  local volume
  volume=$(df -P "$src" | awk 'END{print $NF}')
  [ "$volume" = "$(df -P "$wt" | awk 'END{print $NF}')" ] && mount | grep -qF " on $volume (apfs"
}

clone_dir() { # copy-on-write only: a plain copy costs as much disk as installing
  case "$(uname)" in
    Darwin) same_apfs_volume && cp -c -p -R "$1" "$2" ;;
    Linux) cp -a --reflink=always "$1" "$2" ;;
    *) return 1 ;;
  esac
}

# pnpm already clones every package from its global store, so only npm gains from cloning the main checkout.
cloned=no
if [ "$pm" = npm ] && [ "$state" != installing ] && [ -d "$src/node_modules" ] && [ ! -L "$src/node_modules" ]; then
  echo cloning >"$state_file"
  dirs=()
  while read -r d; do dirs+=("$d/node_modules"); done < <(workspace_dirs)
  for d in "${dirs[@]}"; do rm -rf "${wt:?}/$d"; done # leftovers of an interrupted clone
  cloned=yes
  for d in "${dirs[@]}"; do
    [ -e "$src/$d" ] || continue
    mkdir -p "$(dirname "$wt/$d")"
    if ! clone_dir "$src/$d" "$wt/$d"; then
      echo "copy-on-write clone unavailable between $src and $wt, falling back to a full install"
      for r in "${dirs[@]}"; do rm -rf "${wt:?}/$r"; done
      cloned=no
      break
    fi
  done
  if [ "$cloned" = yes ]; then
    # Absolute links into the source checkout must point at this worktree instead; relative links already do.
    while read -r d; do
      [ -d "$d/node_modules" ] || continue
      find "$d/node_modules" -maxdepth 2 -type l | while read -r link; do
        target=$(readlink "$link")
        case "$target" in "$src"/*) ln -sfn "$wt/${target#"$src"/}" "$link" ;; esac
      done
    done < <(workspace_dirs)
  fi
fi

# Ignored env files the main checkout has and a fresh worktree lacks.
while read -r d; do
  for f in "$d/.env" "$d/.env.local"; do
    if [ -f "$src/$f" ] && [ ! -e "$wt/$f" ]; then cp -p "$src/$f" "$wt/$f"; fi
  done
done < <(workspace_dirs)

echo installing >"$state_file"
if [ "$pm" = pnpm ]; then
  install=(pnpm install --frozen-lockfile --prefer-offline)
else
  install=(npm install --no-save --no-audit --no-fund --prefer-offline)
fi
if "${install[@]}"; then
  echo "done" >"$state_file"
  echo "worktree-setup: dependencies ready in $((SECONDS - start))s ($pm; copy-on-write clone from $src: $cloned; log: $log)" >&3
else
  echo "worktree-setup: ${install[*]} failed after $((SECONDS - start))s; see $log, fix, then rerun bash scripts/worktree-setup.sh" >&3
  exit 1
fi

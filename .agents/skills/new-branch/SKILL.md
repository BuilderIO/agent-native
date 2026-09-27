---
name: new-branch
description: >-
  Create a fresh git branch. Use for an explicit /new-branch request or when a
  task-owned worktree needs a branch to ship detached work. Keep
  platform-assigned Builder.io and Fusion branches in place.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# New Branch

## Activation guard

Use this skill when the user invokes `/new-branch`, asks for a fresh branch, or
`/ship` needs a branch in a dedicated task-owned worktree. Safe branch
operations in that worktree need no extra permission. In a shared checkout,
ask before changing branches unless the user gave the exact operation.
Platform-assigned Builder.io and Fusion branches stay in place; never touch
another checkout or move a branch used by another worktree.

Steve's standing instruction applies across tasks and sessions: needed, safe
branch creation or switching inside a task-owned worktree needs no repeated
permission. It never authorizes moving a branch used by another worktree or
platform, branch changes in a shared checkout, or destructive branch operations.

If the current branch is already suitable, keep using it. When a detached
task-owned worktree needs a branch to ship, create one without pausing for
permission.

### Preserve branch ownership

These are mistakes other agents have made that stranded concurrent work:

- The current branch is attached and suitable for the task — keep using it. A detached task-owned worktree may create a fresh branch to ship.
- A branch is checked out in another worktree — do not move, reset, rebase, or delete it. Choose a fresh task-owned branch instead.
- You're running inside Builder.io / Fusion / a project container. The platform tracks the user's work by the branch it assigned — leaving silently breaks their UI.
- The working tree has uncommitted changes. Preserve them and carry or reapply
  task-owned changes on the new branch; never stash, discard, or overwrite
  them. Stop only when paths are unrelated or belong to another task, and name
  the exact paths that need attention.
- You think a fresh branch would be "tidier." Tidiness is not a goal here; concurrent-agent durability is.

In a task-owned worktree, choose a safe branch and proceed without asking. In a
shared checkout, ask before changing branches unless the user gave the exact
operation.

Fetch `origin/main`, inspect the current branch, dirty paths, and worktree ownership, then create the new branch from the freshest base that preserves all current work. Never stash changes as a shortcut.

## Pre-flight: verify main has the latest merge

Before creating the branch, **always** verify that `origin/main` contains the most recently merged PR. If you just merged a PR (or know one was recently merged), run:

```bash
git fetch origin main
gh pr list --state merged --base main --limit 1 --json number,mergedAt,mergeCommit --jq '.[0]'
git log origin/main --oneline -1
```

Compare the merge commit SHA. If `origin/main` doesn't include it yet, wait and re-fetch — GitHub can take a few seconds to update after a squash merge. **Never create a branch off stale main.** Creating a branch that's missing a just-merged PR causes chaos: subsequent work assumes the merged code is there, leading to conflicts, regressions, and duplicated changes.

## Post-merge `/ship` rotation

During `/ship`, use this path after verifying the merge commit on `origin/main`.
In a task-owned worktree, this safe rotation needs no extra permission. Confirm
there are no unpushed commits on any path and no dirty publishable paths; only
`learnings.md`, `bridge/**`, and `data/**` may remain dirty. If any unpushed
commit remains, keep the source branch checked out and report the commit hashes
instead of rotating. This preserves commits excluded from `/ship:push`. Use the
preserved-path exception only for this post-merge rotation; setup-time branch
creation or switching still requires every dirty path to belong to this task.
The excluded paths stay unchanged across rotation.
immutable `ship_merge_head_oid` captured
before the guarded merge (from the Codex watcher prompt or foreground task
transcript, or the Claude `/goal` or foreground task transcript); never
substitute the live `headRefOid` after merge. This remains verifiable if GitHub
deletes the source branch after squash merge. Fetch origin
and inspect both local and remote source-branch tips before choosing a name and
creating directly from `origin/main`:

```bash
if ! git fetch --no-prune origin; then
  echo "Cannot refresh origin; keep the source branch." >&2
  exit 1
fi
branch=$(git branch --show-current)
if [ -z "$branch" ]; then
  echo "Detached checkout; keep the current worktree unchanged." >&2
  exit 1
fi
ship_head="<persisted-ship_merge_head_oid>"
if ! git cat-file -e "$ship_head^{commit}"; then
  echo "Cannot verify the immutable merged PR head; keep the source branch." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$ship_head" HEAD; then
  echo "Local HEAD does not contain the merged PR head; keep the source branch." >&2
  git log --oneline HEAD --not "$ship_head"
  exit 1
fi
remote_line=$(git ls-remote --heads origin "refs/heads/$branch") || {
  echo "Cannot inspect the remote source branch; keep the source branch." >&2
  exit 1
}
remote_ref="refs/remotes/origin/$branch"
local_unpublished=$(git log --oneline "$ship_head"..HEAD) || {
  echo "Cannot inspect local commits; keep the source branch." >&2
  exit 1
}
remote_unpublished=
if [ -n "$remote_line" ]; then
  if ! git fetch --no-prune origin "refs/heads/$branch:$remote_ref"; then
    echo "Cannot refresh the remote source branch; keep the source branch." >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor "$ship_head" "$remote_ref"; then
    echo "Remote source branch diverged from the merged PR head; keep the source branch." >&2
    git log --oneline "$remote_ref" --not "$ship_head"
    exit 1
  fi
  remote_unpublished=$(git log --oneline "$ship_head".."$remote_ref") || {
    echo "Cannot inspect remote commits; keep the source branch." >&2
    exit 1
  }
fi
if [ -n "$local_unpublished" ] || [ -n "$remote_unpublished" ]; then
  if [ -n "$local_unpublished" ]; then
    printf 'Local commits after the merged PR head:\n%s\n' "$local_unpublished"
  fi
  if [ -n "$remote_unpublished" ]; then
    printf 'Remote commits after the merged PR head:\n%s\n' "$remote_unpublished"
  fi
  echo "Keeping the source branch; report these commits instead of rotating."
else
  dirty_publishable=$(git status --porcelain --untracked-files=all -- . \
    ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**') || {
    echo "Cannot verify the working tree; keep the source branch." >&2
    exit 1
  }
  if [ -n "$dirty_publishable" ]; then
    printf 'Dirty publishable paths:\n%s\n' "$dirty_publishable" >&2
    echo "Keep the source branch until publishable paths are clean." >&2
    exit 1
  fi
  # Replace with a unique name following the Branch naming rules above.
  new_branch="<github-username>/changes-N"
  git switch -c "$new_branch" origin/main || {
    echo "Could not create the next branch; keep the source branch." >&2
    exit 1
  }
fi
```

These unfiltered checks cover local and remote commits on every path; do not
use `/ship`'s excluded-path filter for rotation.

After post-merge rotation, verify the new branch points at current `origin/main`
and excluded local changes are still present. For other branch creation, verify
the branch includes the task commits and dirty work it was meant to carry. Do
not check out or pull a local `main`, stash, force, reset, or touch another
worktree. If Git refuses to carry a path, leave the current checkout intact.
Retaining the source branch because it has unpublished commits is a safe
disposition; platform-assigned Builder.io and Fusion checkouts stay on their
assigned branches and do not use the rotation path.

## Steps

In a task-owned worktree, branch creation or switching needed for the task is
already authorized; do not pause to ask. Before moving, record
`git status --short --untracked-files=all` and classify every staged, unstaged,
and untracked path. A switch carries the whole index and worktree, so proceed
only when every dirty path belongs to this task. If any path is unrelated or
incomplete, keep the checkout in place and report the exact paths without
asking again. Fetch `origin/main`, inspect commits and
`git worktree list --porcelain`, then create an unused branch without stashing
or changing another worktree. Carry current commits and local changes. Use fresh
`origin/main` as the base when that preserves the task's work; otherwise create
from the current task head and reconcile only when the ship workflow requires
it. In a shared checkout, ask before changing branches unless the user gave the
exact operation.

## Branch naming

- Use the pattern `<github-username>/changes-N`, for example `steve8708/changes-545`, where N is at least 50
- Resolve `<github-username>` with `gh api user --jq .login`; do not substitute a display name or local git author name
- Choose N from all local refs and current `origin` refs matching `changes-N`, whether legacy unprefixed or already username-prefixed, so the sequence does not reset
- Ignore older numbers below 50 and unrelated branch names
- If no matching branch exists at 50 or above, start with `<github-username>/changes-50`

## After creation

- Report the new branch name and working tree status.
- If Git cannot carry a local path safely, keep the current checkout and branch
  intact, then report the exact path and conflict. Never stash, discard, or
  overwrite the work to force the switch.

## Important

- **Speed matters** — other agents run concurrently, so minimize time spent on main.
- **Never force-push or reset** — other agents' work may be in-flight.
- **Don't push the new branch** until there are actual changes to ship.
- Do not create or use stashes to move task work between branches.

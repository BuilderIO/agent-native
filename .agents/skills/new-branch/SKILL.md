---
name: new-branch
description: >-
  Use when explicitly asked for /new-branch or a fresh git branch, and for the
  standing detached-worktree setup needed to ship Steve's requested PR. Keep
  platform-assigned Builder.io and Fusion branches in place.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# New Branch

## Activation guard

Use this skill when the user explicitly invokes `/new-branch`, mentions this
skill as the workflow to run, or directly asks you to create a fresh git branch
from main. Steve's explicit request to open a PR or run `/ship` from a detached,
task-owned worktree also carries standing authorization to create and switch to
a task-scoped branch from freshly fetched `origin/main`; do not ask him again
for this setup. This authorization is only for the current task's shipping
branch. A post-merge branch move still requires an explicit request for that
exact operation after `/ship` verifies its merge commit on `origin/main`.
Platform-assigned Builder.io and Fusion branches stay in place. Never move
another checkout.

If neither an explicit new-branch request, the detached `/ship` setup above, nor
the explicitly requested post-merge branch operation applies, **stop here** and
continue the original task without branch movement.

### Do NOT invoke this skill in any of these situations

These are mistakes other agents have made that stranded concurrent work:

- The user said "fix the bug" / "open a PR" / "ship this" / "address review feedback" — those use the **current** branch by default. For Steve's explicit PR or `/ship` request from a detached, task-owned worktree, use the standing shipping-branch authorization above; it does not authorize post-merge rotation.
- The current branch name looks unusual (`ai_*`, `claude/*`, `codex/*`, `changes-N`, `updates-N`, `pr-NNN`, `feat/...`). Those are platform-managed or other agents' branches; moving off looks like work-loss to whoever started them.
- You're running inside Builder.io / Fusion / a project container. The platform tracks the user's work by the branch it assigned — leaving silently breaks their UI.
- The working tree has uncommitted changes. For normal branch requests,
  checkpoint all nonignored work before branching; do not classify by authorship
  or stash it silently. For Steve's detached `/ship` setup, classify each dirty
  path and carry only task-owned changes to the shipping branch. An explicitly
  requested post-merge rotation may carry only its documented `learnings.md`,
  `bridge/**`, and `data/**` exclusions. Unrelated or incomplete work stays put.
- You think a fresh branch would be "tidier." Tidiness is not a goal here; concurrent-agent durability is.

When branch intent is ambiguous outside the standing shipping authorization,
stay on the current branch unless a user decision is genuinely required.

## Detached `/ship` setup for Steve

This is a pre-PR setup in the current task-owned worktree, not post-merge
rotation. Follow the detached-checkout preflight in `ship`: fetch `origin/main`,
classify all staged, unstaged, and untracked paths and detached commits before
branch movement, then choose a unique task-specific branch name and carry only
this task's changes. A branch switch carries the whole worktree; if any dirty
path is unrelated or incomplete, leave the detached checkout in place and
report the exact paths without repeating the authorization question. Do not
stash or use the generic checkout-main flow below. If histories diverge,
preserve the checkout and report the exact conflict.

For ordinary explicit `/new-branch` requests, quickly stash any local changes,
pull latest from `origin/main`, and create a new working branch. The detached
`/ship` setup above carries task changes without stashing.

## Pre-flight: verify main has the latest merge

Before creating the branch, **always** verify that `origin/main` contains the most recently merged PR. If you just merged a PR (or know one was recently merged), run:

```bash
git fetch origin main
gh pr list --state merged --base main --limit 1 --json number,mergedAt,mergeCommit --jq '.[0]'
git log origin/main --oneline -1
```

Compare the merge commit SHA. If `origin/main` doesn't include it yet, wait and re-fetch — GitHub can take a few seconds to update after a squash merge. **Never create a branch off stale main.** Creating a branch that's missing a just-merged PR causes chaos: subsequent work assumes the merged code is there, leading to conflicts, regressions, and duplicated changes.

## Explicitly requested post-merge `/ship` rotation

When the user explicitly requests the exact branch operation during `/ship`,
use this path after verifying the merge commit on `origin/main`. In the current
user-owned worktree, confirm there are no unpushed commits on any path
and no dirty publishable paths; only `learnings.md`, `bridge/**`, and `data/**`
may remain dirty. If any unpushed commit remains, keep the source branch checked
out and report the commit hashes instead of rotating. This preserves commits
excluded from `/ship:push`. Use the immutable `ship_merge_head_oid` captured
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

Verify the new branch points at current `origin/main` and the excluded local
changes are still present. Do not check out or pull a local `main`, stash,
force, reset, or touch another worktree. If Git refuses to carry an excluded
path, leave the current worktree intact. Retaining the source branch because it
has unpublished commits is a safe branch disposition; platform-assigned
Builder.io and Fusion checkouts stay on their assigned branches and do not use
this path.

## Steps

For an ordinary `/new-branch`, run the generic command below. For a
post-merge `/ship` rotation, use the dedicated path above instead.

Run as a single chained command to minimize time off-branch. Resolve the
authenticated GitHub username before choosing the branch name so concurrent
users have separate branch namespaces. The `git stash push` is gated so we
**only pop a stash we just created** — never an old stash from a previous
session. The stash name embeds the source branch so an orphan can be identified
later (orphans are how we've lost work in the past — see "Post-flight check"
below):

```bash
GITHUB_USER=$(gh api user --jq .login) && test -n "$GITHUB_USER" || { echo "Unable to resolve the authenticated GitHub username" >&2; exit 1; }; LATEST=$({ git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin; git ls-remote --heads origin; } | sed -E -e 's#^[0-9a-f]+[[:space:]]+refs/heads/##' -e 's#^origin/##' | sed -nE 's#^([^/]+/)?changes-([0-9]+)$#\2#p' | awk '$1 >= 50 { print }' | sort -n | tail -1); NEXT=$(( ${LATEST:-49} + 1 )); BRANCH_NAME="${GITHUB_USER}/changes-${NEXT}"; SOURCE=$(git branch --show-current); STASH_MSG="new-branch-from-${SOURCE:-detached}-$(date +%s)"; if git diff-index --quiet HEAD --; then CREATED=0; else git stash push -m "$STASH_MSG" && CREATED=1 || CREATED=0; fi; git checkout main && git pull origin main && git checkout -b "$BRANCH_NAME" && if [ "$CREATED" = "1" ]; then git stash pop; else echo "(no stash to pop)"; fi; echo "--- Done: $(git branch --show-current)"
```

Why the gate: `git stash push` exits 0 even when there are no local changes ("No local changes to save"), so chaining `&& CREATED=1` would always set CREATED=1 and an unconditional `git stash pop` would pop a *pre-existing* stash from earlier work, dumping unrelated files into the working tree. The `git diff-index --quiet HEAD --` pre-check exits 0 only when there are no differences against HEAD in **tracked** files — we skip stashing entirely in that case so there's nothing to pop. Untracked files are intentionally not part of the gate (and not stashed): for a fast new-branch flow, untracked files following the user across `git checkout` is the desired behaviour, and `git stash push` without `-u` already ignores them. We let `git stash pop` errors (e.g. merge conflicts) surface naturally rather than swallowing them with `2>/dev/null`, since the next section assumes you'll see and resolve them.

## Branch naming

- Use the pattern `<github-username>/changes-N`, for example `steve8708/changes-545`, where N is at least 50
- Resolve `<github-username>` with `gh api user --jq .login`; do not substitute a display name or local git author name
- Choose N from all local refs and current `origin` refs matching `changes-N`, whether legacy unprefixed or already username-prefixed, so the sequence does not reset
- Ignore older numbers below 50 and unrelated branch names
- If no matching branch exists at 50 or above, start with `<github-username>/changes-50`

## After creation

- Report the new branch name and working tree status.
- **If stash pop had merge conflicts** that you can confidently resolve (e.g. `--theirs` for `pnpm-lock.yaml`), resolve them and proceed. **If you can't resolve them confidently, abort the new branch instead of leaving the work stranded:**
  ```bash
  git checkout --merge .         # back out the conflicted pop (stash stays in list)
  git checkout -                  # back to the source branch
  git branch -D <new-branch>      # remove the freshly-created branch
  git stash list | head -3        # show the stash so the user can act on it
  ```
  Then surface to the user: "Stash pop conflicted on `<files>`; the new branch was rolled back and `<stash-name>` is preserved. Want me to retry, drop the stash, or stay on the source branch?" **Never silently leave a half-built branch + an orphaned stash** — that's how concurrent-agent work disappears.
- If stash pop brought back `.claude/worktrees` files, unstage them with `git reset HEAD .claude/worktrees`.
- If a pop accidentally happened and brought in unrelated files (because the gate was bypassed), do NOT silently resolve conflicts. The stashed content stays in the stash list, so discard the popped working-tree changes (`git rm` deleted-by-us files, `git checkout --ours` for both-modified files) and surface this to the user.

## Post-flight check

After every `/new-branch` invocation, list any pre-existing stashes and surface them to the user. Orphaned `new-branch-from-*` / `WIP on *` / `babysit-tick*-concurrent-work-*` stashes are how we've lost real work in the past — they pile up unnoticed.

```bash
git stash list
```

If the list shows stashes that aren't yours-from-this-run, name them in your response:

> Heads-up — there are 3 pre-existing stashes (`stash@{1}: WIP on updates-238`, `stash@{2}: On changes-3: new-branch-1777654416`, `stash@{3}: babysit-tick4-concurrent-work...`). These may contain unrecovered work. Want me to inspect them?

This is the only reliable way to catch the leak — git won't warn you on its own.

## Important

- **Speed matters** — other agents run concurrently, so minimize time spent on main.
- **Never force-push or reset** — other agents' work may be in-flight.
- **Don't push the new branch** until there are actual changes to ship.
- **Treat orphaned stashes as bugs.** If you see a `new-branch-from-*` stash older than this session, surface it. Don't drop it without the user's confirmation — it may be the only copy of someone's work.

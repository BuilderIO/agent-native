---
name: new-branch
description: >-
  Only when explicitly asked for /new-branch or a fresh git branch: stash local
  changes, update main, and create it. Do not auto-run for normal coding, PR,
  Builder.io, or Fusion branch workflows.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# New Branch

## Activation guard

Use this skill only when the user explicitly invokes `/new-branch`, mentions this skill as the workflow to run, or directly asks you to create a fresh git branch from main.

If this skill was loaded without an explicit user request to create a new branch, **stop here**. Report that branch movement requires explicit confirmation, then continue the original task on the current branch.

### Do NOT invoke this skill in any of these situations

These are mistakes other agents have made that stranded concurrent work:

- The user said "fix the bug" / "open a PR" / "ship this" / "address review feedback" — those work on the **current** branch. PR and ship workflows in this repo push the current branch; they don't branch-then-push.
- The current branch name looks unusual (`ai_*`, `claude/*`, `codex/*`, `changes-N`, `updates-N`, `pr-NNN`, `feat/...`). Those are platform-managed or other agents' branches; moving off looks like work-loss to whoever started them.
- You're running inside Builder.io / Fusion / a project container. The platform tracks the user's work by the branch it assigned — leaving silently breaks their UI.
- The working tree has uncommitted changes from work you didn't do. Branching stashes them, and orphaned stashes are how we've lost work in the past. Surface the changes to the user first, never stash silently.
- You think a fresh branch would be "tidier." Tidiness is not a goal here; concurrent-agent durability is.

When in doubt: stay on the current branch. Ask the user before moving.

Quickly stash any local changes, pull latest from origin/main, and create a new working branch. Designed to be as fast as possible since other agents may be working concurrently on this repo.

## Pre-flight: verify main has the latest merge

Before creating the branch, **always** verify that `origin/main` contains the most recently merged PR. If you just merged a PR (or know one was recently merged), run:

```bash
git fetch origin main
gh pr list --state merged --base main --limit 1 --json number,mergedAt,mergeCommit --jq '.[0]'
git log origin/main --oneline -1
```

Compare the merge commit SHA. If `origin/main` doesn't include it yet, wait and re-fetch — GitHub can take a few seconds to update after a squash merge. **Never create a branch off stale main.** Creating a branch that's missing a just-merged PR causes chaos: subsequent work assumes the merged code is there, leading to conflicts, regressions, and duplicated changes.

## Steps

Run as a single chained command to minimize time off-branch. The `git stash push` is gated so we **only pop a stash we just created** — never an old stash from a previous session. The stash name embeds the source branch so an orphan can be identified later (orphans are how we've lost work in the past — see "Post-flight check" below):

```bash
SOURCE=$(git branch --show-current); STASH_MSG="new-branch-from-${SOURCE:-detached}-$(date +%s)"; if git diff-index --quiet HEAD --; then CREATED=0; else git stash push -m "$STASH_MSG" && CREATED=1 || CREATED=0; fi; git checkout main && git pull origin main && git checkout -b <branch-name> && if [ "$CREATED" = "1" ]; then git stash pop; else echo "(no stash to pop)"; fi; echo "--- Done: $(git branch --show-current)"
```

Why the gate: `git stash push` exits 0 even when there are no local changes ("No local changes to save"), so chaining `&& CREATED=1` would always set CREATED=1 and an unconditional `git stash pop` would pop a *pre-existing* stash from earlier work, dumping unrelated files into the working tree. The `git diff-index --quiet HEAD --` pre-check exits 0 only when there are no differences against HEAD in **tracked** files — we skip stashing entirely in that case so there's nothing to pop. Untracked files are intentionally not part of the gate (and not stashed): for a fast new-branch flow, untracked files following the user across `git checkout` is the desired behaviour, and `git stash push` without `-u` already ignores them. We let `git stash pop` errors (e.g. merge conflicts) surface naturally rather than swallowing them with `2>/dev/null`, since the next section assumes you'll see and resolve them.

## Branch naming

- Use the pattern `changes-N` where N is at least 50
- Ignore older `changes-*` branches below 50 when choosing the next branch number
- Check existing branches: `git branch | grep changes- | sort -t- -k2 -n | tail -1`
- If no prior branch exists at 50 or above, start with `changes-50`

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

---
name: new-branch
description: Stash, pull latest main, and create a new branch — fast, to minimize disruption to concurrent agents
user_invocable: true
---

# New Branch

Quickly stash any local changes, pull latest from origin/main, and create a new working branch. Designed to be as fast as possible since other agents may be working concurrently on this repo.

## Steps

Run as a single chained command to minimize time off-branch. The `git stash push` is gated so we **only pop a stash we just created** — never an old stash from a previous session:

```bash
STASH_MSG="new-branch-$(date +%s)" && git stash push -m "$STASH_MSG" && CREATED=1 || CREATED=0; git checkout main && git pull origin main && git checkout -b <branch-name> && { [ "$CREATED" = "1" ] && git stash pop 2>/dev/null || echo "(no stash to pop)"; }; echo "--- Done: $(git branch --show-current)"
```

Why the gate: `git stash` returns success even when there are no local changes, so an unconditional `git stash pop` will pop a *pre-existing* stash from earlier work and dump unrelated files into the working tree. Only pop if we actually pushed a stash this run.

## Branch naming

- Use the pattern `changes-N` where N increments from the last `changes-*` branch
- Check existing branches: `git branch | grep changes- | sort -t- -k2 -n | tail -1`
- If no prior branch exists, start with `changes-1`

## After creation

- Report the new branch name and working tree status
- If stash pop had merge conflicts, resolve them (prefer `--theirs` for `pnpm-lock.yaml`)
- If stash pop brought back `.claude/worktrees` files, unstage them with `git reset HEAD .claude/worktrees`
- If a pop accidentally happened and brought in unrelated files (because the gate was bypassed), do NOT silently resolve conflicts. The stashed content stays in the stash list, so discard the popped working-tree changes (`git rm` deleted-by-us files, `git checkout --ours` for both-modified files) and surface this to the user.

## Important

- **Speed matters** — other agents run concurrently, so minimize time spent on main
- **Never force-push or reset** — other agents' work may be in-flight
- **Don't push the new branch** until there are actual changes to ship

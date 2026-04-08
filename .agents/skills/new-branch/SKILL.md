---
name: new-branch
description: Stash, pull latest main, and create a new branch — fast, to minimize disruption to concurrent agents
user_invocable: true
---

# New Branch

Quickly stash any local changes, pull latest from origin/main, and create a new working branch. Designed to be as fast as possible since other agents may be working concurrently on this repo.

## Steps

Run everything in a single chained command to minimize time off-branch:

```bash
git stash && git checkout main && git pull origin main && git checkout -b <branch-name> && git stash pop 2>/dev/null; echo "--- Done: $(git branch --show-current)"
```

## Branch naming

- Use the pattern `updates-N` where N increments from the last `updates-*` branch
- Check existing branches: `git branch | grep updates- | sort -t- -k2 -n | tail -1`
- If no prior branch exists, start with `updates-1`

## After creation

- Report the new branch name and working tree status
- If stash pop had merge conflicts, resolve them (prefer `--theirs` for `pnpm-lock.yaml`)
- If stash pop brought back `.claude/worktrees` files, unstage them with `git reset HEAD .claude/worktrees`

## Important

- **Speed matters** — other agents run concurrently, so minimize time spent on main
- **Never force-push or reset** — other agents' work may be in-flight
- **Don't push the new branch** until there are actual changes to ship

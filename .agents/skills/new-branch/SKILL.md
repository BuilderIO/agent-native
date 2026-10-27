---
name: new-branch
description: >-
  Name and create a task branch from fresh origin/main, and rotate a
  task-owned worktree to a new branch after its PR merges. Use when asked for
  a fresh branch, when /ship needs a branch for detached work, and after a
  merge.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# New Branch

A task-owned worktree can create or switch branches without asking. A shared
checkout keeps its branch. Platform-assigned Builder.io and Fusion branches stay
where they are. Never move a branch that another worktree has checked out
(`git worktree list --porcelain`), and never stash, reset, or force anything.

If the current branch already suits the task, keep using it.

## Name

`<login>/changes-N`, for example `steve8708/changes-545`.

```bash
login=$(gh api user --jq .login)
git fetch origin --quiet
git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin \
  | sed -nE "s#^(origin/)?$login/changes-([0-9]{2,6})\$#\2#p" | sort -n | tail -1
```

Use that number plus one, or 50 if nothing matches. Only your own prefixed
branches count, and six digits at most, which skips legacy and
timestamp-named branches. Any N that no local or origin branch uses is fine.

## Create

```bash
git status --short --untracked-files=all
git fetch origin --quiet
git switch -c "$login/changes-N" origin/main
```

Never branch from a local `main`, which can be stale. Dirty files come along
on the switch, so check the list first: if some belong to another task, leave
the checkout where it is and name those paths. If the branch is for an
existing PR update, base it on that PR's freshly fetched live head instead of
`origin/main` (see `babysit-pr` for the push target). Don't push the new
branch until it has changes to ship.

## After a merge

Rotate only when the PR merged, the tree is clean, and nothing is unpushed.

```bash
git fetch origin --quiet
git merge-base --is-ancestor <mergeCommit.oid> origin/main
git status --porcelain --untracked-files=all
git log --oneline <ship_merge_head_oid>..HEAD
```

- `mergeCommit.oid` comes from `gh pr view <number> --json mergeCommit`. If it
  isn't in `origin/main` yet, wait a few seconds and fetch again.
- `ship_merge_head_oid` is the head `/ship` saved before merging. The `git log`
  must print nothing, which means no commits landed after the merged head.
  Also check the remote branch has none:
  `git log --oneline <ship_merge_head_oid>..origin/<branch>`.
- If anything is dirty or unpushed, keep the branch and list the paths or
  commits.

When it's all clear, create the next branch from `origin/main` as above. In a
shared checkout, don't rotate; leave its branch as it is.

---
name: concurrent-agents
description: >-
  How to work safely when many Claude Code and Codex agents share this one
  checkout at once. Use before editing any file, before concluding someone
  reverted your work, before any branch operation, and before committing,
  pushing, or merging — this is almost always relevant here.
scope: dev
metadata:
  internal: true
---

# Concurrent Agents

Steve runs many Claude Code and Codex sessions against this one checkout on
purpose, often on the same branch or file. Default assumption on every task:
the working tree is shared branch state. Read existing changes before editing
them, and never reset, clean, stash, or overwrite local work without explicit
authorization.

## Read before you edit

Before touching a file that already has uncommitted changes, re-read it and
build your edit on top of what's there. Landing your own complete fix over a
peer's in-progress one has happened repeatedly — "another agent landed its own
complete fix for the exact same bug in the exact same file, overwriting my
in-progress edits on disk." There is no conflict, no warning; the edit vanishes.

## Diagnosing "did someone revert my work" — correctly

`git diff --stat` line counts are not evidence of a revert — a refactor can
show the same magnitude of deletions. An agent once announced a revert from
stat counts alone and was wrong; it cost a full investigation to disprove.
Before you say "reverted" out loud, run:

```bash
git log --oneline <base>..HEAD    # what actually landed, in order
git diff <base>..HEAD -- <path>   # the real hunks for the files in question
```

Read the hunks: a revert removes logic and puts nothing equivalent back; a
refactor removes the same lines and adds different code doing the same job.
Only the hunks tell you which happened — never `--stat` alone.

## Shallow or grafted worktrees

Shallow clones and grafted worktrees do not have complete ancestry. Treat
`git log -S` and `git merge-base --is-ancestor` results at their boundary as
inconclusive; fetch complete history or verify the date through the remote
commit or pull-request record before calling a change the first occurrence.

## Create isolated task work safely

Steve has granted standing permission to create a task-owned worktree on a new
branch when isolation helps; do not ask for branch-creation permission again.
Fetch `origin/main` first and use that remote-tracking ref as the base. Leave
the existing shared checkout and peer worktrees on their current branches.
Do not delete, reset, rebase, stash, force-push, or overwrite peer work to make
room for a new task.

For deliberate post-merge branch rotation, follow `new-branch`'s freshness and
unpublished-work checks. Do not rotate a platform-assigned branch or strand
unpublished commits.

## Before you ship

Before you commit, push, or merge, check `git log --oneline -5`, `git status`,
and `gh pr list --head <branch>` for the current PR. If the work you were
about to do just landed, continue from the latest branch snapshot.

## Reading a Codex peer's intent

Relaying between agents by hand is the user's most tedious job — don't make
him paste what a Codex session is doing. Read its transcript yourself:

```bash
ls ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

Each line is a JSON event; `payload.type == "user_message"` is what the user
asked, `payload.type == "agent_message"` is what it answered — enough to learn
a peer's task without interrupting it or the user.

## Related

- `new-branch` — isolated task worktrees and guarded post-merge branch rotation.
- `ship` — the commit/push/PR workflow for the complete branch snapshot.

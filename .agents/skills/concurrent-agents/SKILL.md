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

## Never move branches without an explicit instruction

Don't create, switch, delete, reset, rebase, stash, or worktree-add a branch
unless the user asked for that exact operation in the current task — it
strands every other agent on it. This isn't a tool-level block anymore —
`.agents/skills/new-branch/SKILL.md` carries it now, through an activation
guard that refuses to fire unless the user explicitly asked for `/new-branch`
or a fresh branch. That guard is what took unrequested branch creation from a
recurring complaint to zero; read it before any branch operation instead of
assuming a prohibition still lives at the tool layer.

## Timing the next branch

Before running `/new-branch`, even on an explicit request, confirm that the
current branch has been fully checkpointed and inspect the active worktrees:

```bash
git status --short
ls .claude/worktrees/ 2>/dev/null
gh pr list --head "$(git branch --show-current)" --state open
```

Run `corepack pnpm ship:push` for any nonignored changes before moving to the
next branch. Do not leave local work behind during branch rotation.

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

- `new-branch` — the one workflow allowed to move branches, only on explicit
  `/new-branch` invocation.
- `ship` — the commit/push/PR workflow for the complete branch snapshot.

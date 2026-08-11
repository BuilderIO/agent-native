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
any uncommitted change you did not make is a peer's live, in-progress work —
not clutter, not a mistake, not yours to clean up, revert, or "tidy" away.
Modified or untracked files you don't recognize are this repo's normal state.

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

## Timing the next branch around in-flight peers

Unrequested branch creation is solved; the residual risk now is timing.
Cutting a fresh branch right after your own merge, while other agents are
still mid-flight on the branch you're about to leave, strands their
uncommitted work just as surely as an unrequested branch move would. Before
running `/new-branch`, even on an explicit request, check who else is still
using the current branch:

```bash
git status --short                          # uncommitted changes here — yours or a peer's
ls -la .claude/leases/ 2>/dev/null           # fresh (<15 min) leases = a session actively editing
ls .claude/worktrees/ 2>/dev/null            # peers working this branch from a separate worktree
gh pr list --head "$(git branch --show-current)" --state open
```

If any of those show live activity, say so and confirm with the user before
moving off the branch — don't assume a merge landing means everyone else is
done with it too.

## File leases

`scripts/hooks/file-lease.mjs` claims a file on every edit and denies the next
write when another live session leased it in the last 15 minutes, or the file
changed on disk since your session last wrote it. Both mean stop and look, not
force through: work a different file, or re-read it and build on the landed
change before writing again. If it's genuinely your file being taken back,
say so in your response after re-reading.

It only covers writes made through this hook: a Codex peer or a plain human
edit leaves no lease, and it can't see a collision that reaches the same file
through any other path. Treat it as a backstop for the Claude-Code case, not a
substitute for "read before you edit" above. Confirm it's actually wired before
relying on it — a documented hook and a registered one are different things:

```bash
grep -l file-lease .claude/settings.json 2>/dev/null || echo "not registered"
```

## Before you ship

Assume another agent may already be committing, pushing, or opening a PR for
the same fix — "stop shipping, another agent is doing that right now" is a
real recurring collision. Before you commit, push, or merge, check `git log
--oneline -5`, `git status`, and `gh pr list --head <branch>` for a PR someone
already opened. If the work you were about to do just landed, say so and stop.

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
- `ship` — the commit/push/PR workflow; check for an in-flight peer first.

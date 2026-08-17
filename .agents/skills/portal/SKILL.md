---
name: portal
description: >-
  Continue a coding session on a paired always-on computer. Use when work must
  survive closing the primary laptop, needs remote computer-use testing, or
  should run on a scheduled/self-hosted execution host.
scope: both
---

# Portal

Portal moves a local coding session to a paired computer while keeping the
relay as the control plane and the paired computer as the execution residence.
The Code Agents chat list supports moving one local chat or all eligible local
and worktree chats in one handoff.

## Workflow

1. Select `Portal` for the coding session and keep the source folder as a Git
   repository with an `origin` remote.
2. Snapshot the current working tree, including dirty tracked and untracked
   code, into a unique `portal/<timestamp>-<id>` branch. Do not switch, reset,
   stash, or overwrite the source checkout.
3. Queue the run for a paired active host. The run metadata must identify the
   host, handoff id, branch, commit, and `envPolicy: "load-local"`.
4. On the paired host, fetch the exact commit into a detached Portal worktree
   under its local Agent-Native store. Preserve an existing dirty worktree and
   create a new one instead of overwriting it.
5. Load the paired host's current local environment files immediately before
   starting the runner. Never put environment values, tokens, or secrets in
   relay metadata, prompts, transcripts, or status messages.

## Existing chat transfer

Use `Move to Portal` for one chat or `Move local chats to Portal` for the bulk
handoff. The transfer stops a local runner before snapshotting, pushes the
current worktree without changing the source checkout, and imports the full
text transcript into the same run id on the paired computer. The target gets a
continuation turn rather than replaying the original prompt. Chats waiting for
local approval are skipped because approval state is computer-local and cannot
be reconstructed safely.

Binary attachment bodies are not relayed. Their names, text, and an explicit
omission marker remain in the transcript context. Oversized or otherwise
unsafe context fails visibly so the source chat can be retried instead of being
silently truncated.

## Execution residence

Treat `metadata.executionResidence` as authoritative for where the run is
executing. It should report `kind: "portal"`, host id and label, handoff id,
source commit, remote workspace path once prepared, and environment file names
without values. Follow-ups and stops must target the same host and remote run.

## Verification

Before saying Portal is ready, verify the relay has a paired host, the host is
heartbeating, the exact handoff commit was fetched, the detached worktree is
clean, and the run metadata reports the remote workspace. For an existing chat,
also verify the target transcript contains the imported event count and the
continuation turn. A queued command is not proof that the remote runner
started; inspect the remote result or event readback.

## Don't

- Do not copy `.env` contents or credentials to the source branch or relay.
- Do not treat the primary laptop's cwd or environment as the remote cwd.
- Do not report Portal complete from a local push alone; confirm remote
  execution residence and runner state.

## Related skills

- `external-agents` - relay and external-agent boundaries.
- `a2a-protocol` - idempotent cross-agent task lifecycle.
- `concurrent-agents` - preserve shared checkouts and peer work.
- `reliable-mutations` - verify durable handoff state.

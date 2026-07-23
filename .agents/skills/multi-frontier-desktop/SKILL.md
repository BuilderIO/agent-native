---
name: multi-frontier-desktop
description: >-
  Run or extend the Desktop Code Agents Multi-Frontier workflow. Use when coordinating Codex and Claude Code subscriptions, collaboration phases, checkpoints, recovery, usage meters, or helper admission.
scope: dev
---

# Multi-Frontier Desktop

## Rule

Multi-Frontier is a Desktop-only, local Code Agents workflow with exactly two
subscription-native participants: Codex through ChatGPT and Claude Code through
Claude. Electron main owns every privileged operation, durable state transition,
provider process, and write lease. The renderer is presentation and command
intent only.

## Before a collaboration

1. Connect subscriptions through their own CLI sign-in flow. Use `codex login`
   for ChatGPT and `claude auth login --claudeai` for Claude. Never ask for,
   parse, copy, extract, log, or persist OAuth credentials, auth files,
   Keychain values, or rollout data.
2. Read provider status through the typed Desktop host/preload/IPC operations.
   Do not call Node, child processes, app-server stdio, or the filesystem from
   the renderer.
3. Present only provider-reported plan and usage fields. Missing data is “Not
   reported by provider,” not zero. Codex may show capability-probed live usage
   and credits. Claude v1 shows connection and plan tier with explicit “Live
   usage unavailable” when its supported session side channel cannot report it.
4. Treat account identity and provider raw payloads as private. They do not
   belong in collaboration state, artifacts, transcript metadata, usage
   snapshots, logs, telemetry, or IPC. Keep renderer cards compact and disclose
   meter details in an accessible popover.

## Collaboration workflow

1. Start both participants as read-only. They independently produce bounded
   proposal artifacts.
2. Give each participant the other proposal, the original request, and bounded
   repository evidence for cross-review. Number findings by consequence.
3. Allow at most one revision per participant per round and retain
   supersession links; never overwrite an earlier proposal or review.
4. Publish a compact, attributed convergence summary. Stop after three rounds
   rather than guessing through a material disagreement.
5. Default to an inline explicit **GO**. Per-run auto-continue is permitted
   only after recorded agreement on a reversible path. It never disables
   escalation for scope or intent ambiguity, destructive work, security or
   privacy impact, external communication, meaningful cost expansion, or
   irreversible data or architecture decisions.
6. Grant `workspace_write` only to the current driver generation after GO. The
   other participant remains read-only. Do not rely on prompts for this rule.
7. At a stable driver turn or material-diff boundary, revoke the write lease,
   record an immutable bounded checkpoint, and let the watchdog review that
   checkpoint rather than a moving worktree. Record each finding as addressed,
   rejected with rationale, or deferred with rationale.
8. On cancellation, crash, quit, or restart, stop owned children, revoke the
   lease, persist a paused recovery record, and require an explicit newly
   fenced continuation. Never automatically resume native execution after
   recovery.

## Helper and quota policy

- Use capability-probed inexpensive models for read-only research, test
  analysis, and review only. Record requested and effective model for every
  helper launch; omission must not inherit an expensive frontier model.
- Pass helpers bounded prompts and artifacts, not raw transcripts. Enforce task
  and delegation-depth caps.
- An editing helper needs a formal driver-lease handoff after the original
  driver is suspended. Two workspace-write processes are never allowed.
- Usage is advisory. Warn before optional work near a reported limit and stop
  launching optional helpers/watchdog work at the configured threshold. Let a
  running provider report its own authoritative limit error.

## Persistence and UI

- Preserve existing single-agent Code behavior. Multi-Frontier state is
  versioned, additive, file-backed local Code-run data with atomic parent
  updates and bounded append-only events/artifacts.
- Persist safe identifiers, phase, roles, lease generation, approval,
  checkpoint/proposal/review references, opaque session references, and bounded
  summaries only. Never persist full prompts, diffs, unbounded provider output,
  credentials, account identifiers, or raw app-server events.
- Keep the Code Agents surface calm and progressively disclosed: add the mode,
  participants, and per-run auto-continue choice to the existing composer; show
  phase as a subtle status line and roles as two small badges; keep proposal,
  review, and checkpoint evidence compact and collapsed by default; put rare
  pause, cancel, and role-swap controls in the existing run menu where possible.
  Use accessible status announcements and the shared composer stack instead of
  a bespoke prompt field.

## Verification

- Exercise the typed IPC boundary with hostile renderer inputs; renderer state
  must not become command authority.
- Prove stale driver generations, duplicate events, and concurrent write turns
  are rejected.
- Prove cancellation and checkpoint transitions cannot leave a write-capable
  child running.
- Verify recovery is persistence-only until explicit user continuation.
- Run focused Desktop tests/typecheck, format modified files, and record
  packaged-runner and installed-app evidence in `MULTI_FRONTIER_PROOF.md`.

## Don't

- Do not add hosted SQL, hosted parent-thread orchestration, Keychain/OAuth
  scraping, or undocumented provider usage endpoints to Desktop v1. Keep an
  API-key path explicitly separate; never silently substitute it for a
  subscription runtime.
- Do not display a missing provider meter as zero or fabricate freshness,
  remaining tokens, dollars, or a plan limit.
- Do not use a modal as the normal convergence path, let a watchdog inspect a
  moving worktree, or permit a write-capable helper without a lease handoff.

## Related Skills

- `harness-agents` — native harness boundaries.
- `security` — credential and sensitive-data handling.
- `onboarding` — user-initiated provider connection flows.
- `ship-desktop` — installed-app and packaged verification.
- `frontend-design` and `shadcn-ui` — compact, accessible Desktop UI.

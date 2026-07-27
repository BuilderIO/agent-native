---
name: agent-watchdog
description: Use when asked to watch, babysit, audit, review, compare, or fix another agent's work from a Codex session ID, Claude Code session/transcript, chat/thread link, PR, branch, log, or pasted run summary. Monitor until the other agent is done or blocked, reconstruct what the user asked, inspect what the agent actually changed and verified, report gaps, and optionally make scoped fixes when the user authorizes repair.
---

# Agent Watchdog

Watch another agent's work like a reviewer with a pager: wait for completion
when needed, reconstruct the request, verify the evidence, and close the gap
between what was asked and what actually happened.

## Choose The Mode

Infer the mode from the user's wording:

- **Watch only:** monitor a session, PR, branch, CI run, or transcript until it
  reaches a terminal state. Do not edit files.
- **Audit:** read the prompt, transcript, diff, tests, CI, comments, screenshots,
  or final claims and return a gap report. Do not edit files.
- **Audit and fix:** audit first, then make narrow fixes for clear gaps. Avoid
  broad rewrites, branch movement, or speculative changes.
- **Compare:** when given multiple sessions or agents, compare their work against
  the same original request and reconcile the important differences.

If authority is unclear, default to audit-only and say what you would fix.

## Resolve The Target

1. Identify every artifact the user supplied: session ID, transcript path,
   thread URL, PR, branch, commit, CI run, issue, Slack link, or pasted summary.
2. Use the host's native thread/history tools, local transcript files, repo
   logs, GitHub tools, or pasted content to resolve the artifact. Prefer the
   most direct source over summaries.
3. If the artifact is still running and the user asked to watch, poll at a
   reasonable interval until it is done, blocked, stale, or clearly waiting on a
   human/external system.
4. If the artifact cannot be resolved, ask for the missing identifier or path.

## Reconstruct The Contract

Build a compact contract before judging the work:

- Original user request and any later changes in scope.
- Explicit constraints: branch rules, no-edit requests, deadlines, package
  versions, validation expectations, design requirements, or security/privacy
  limits.
- Implied acceptance criteria: user-visible behavior, tests, CI, docs, deploys,
  screenshots, review replies, or status updates.
- The other agent's final claims and any "could not do" caveats.

Treat the user's request as the source of truth, not the other agent's summary.

## Audit The Evidence

Inspect evidence, not vibes:

- Read changed files and relevant unchanged files around the touched paths.
- Check git status/diff without reverting unrelated work.
- Compare commands the agent claimed to run with actual output when available.
- Inspect failed or skipped tests, CI logs, browser screenshots, review
  comments, deploy output, and error traces.
- For PR/review work, verify unresolved threads and CI state from the source
  system when tools are available.
- For UI work, prefer screenshots or browser checks over prose claims.

Classify each issue as:

- **Gap:** requested behavior is missing or incomplete.
- **Bug:** the implementation likely fails or regresses behavior.
- **Verification miss:** the work may be right but the evidence is weak.
- **Scope drift:** the agent changed something unrelated or skipped a constraint.
- **No issue:** the concern is already handled, with evidence.

## Fix Narrowly

When the user authorized repair:

1. Fix only gaps with clear evidence.
2. Preserve unrelated local changes and do not move branches unless explicitly
   asked for that branch operation.
3. Use existing repo patterns and targeted tests.
4. Re-run the smallest useful validation after each meaningful fix.
5. If a fix would require a product decision, credential, destructive action, or
   broad rewrite, stop and report the decision instead of guessing.

## Report

Lead with the outcome. Keep the report short enough to scan:

```md
Status
- Done, blocked, stale, or still running.

Requested
- What the user asked the watched agent to do.

Observed
- What the watched agent changed, claimed, and verified.

Gaps
- Missing behavior, bugs, weak verification, or scope drift.

Fixes made
- Files changed and validation run. Omit this section for audit-only work.

Remaining risk
- Anything still unverified or waiting on CI/review/deploy/human input.
```

Name exact files, commands, PRs, or thread IDs when they matter.

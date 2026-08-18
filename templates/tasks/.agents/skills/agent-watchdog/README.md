# /agent-watchdog

Audit another agent's work from a session, transcript, PR, branch, or run
summary.

`/agent-watchdog` is for the common handoff where one agent needs to watch
another agent finish, then check whether the work actually matches what was
asked.

## What It Does

- Resolves Codex, Claude Code, PR, branch, transcript, or pasted run artifacts.
- Waits for completion when the user asks to watch.
- Reconstructs the original request and later scope changes.
- Checks the agent's claims against diffs, files, tests, CI, screenshots, and
  review state.
- Reports gaps, weak verification, scope drift, and residual risk.
- Makes narrow fixes when the user explicitly authorizes repair.

## When To Use It

Use it when a user says things like:

- "Watch this session until done and audit it."
- "Claude finished, check what it did and fix gaps."
- "Compare these two agents' work."
- "Babysit this PR and make sure the agent actually handled the feedback."

Skip it for normal code review when there is no other agent session or run to
audit.

## Modes

- Watch only: monitor and report, no edits.
- Audit: inspect the work and produce a gap report, no edits.
- Audit and fix: repair clear gaps with targeted validation.
- Compare: evaluate multiple sessions against the same request.

## Install

```sh
npx @agent-native/skills@latest add --skill agent-watchdog
```

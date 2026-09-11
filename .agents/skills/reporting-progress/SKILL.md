---
name: reporting-progress
description: >-
  What to say while long work is still running, and what a legal mid-task stop
  looks like. Use during any run over a few minutes — migrations, sweeps,
  babysit loops, automations, deploys — and at the moment you are tempted to
  stop and ask, report a blocker, or answer "how's it going?".
scope: dev
metadata:
  internal: true
---

# Reporting Progress

Measured on 2026-08-12, "had to chase status on a long-running run" was the
single most frequent correction in this repo — 86 in two weeks, more than
false-done and collisions combined. Every one of them is the user asking a
question the agent could have answered before being asked.

## A turn ends in exactly one of two shapes

**Done**, with the artifact that proves it — a command's output, a sha, a URL,
a screenshot file. `verifying-changes` says which artifact per area. A sentence
describing a check you would run is not an artifact.

**Blocked**, on one line:

```
BLOCKED: <what is stopping you> — unblock: <one thing the user can do in under a minute>
```

Anything else is a stall. "I'm looking into it", "let me know how you want to
proceed", and a status paragraph with no ask are all stalls.

## Exhaust this before writing BLOCKED

In the measured cases, every single "blocked" was a step the agent could have
taken:

1. Run it locally instead of waiting on a deploy or CI.
2. Drive the user's logged-in Chrome instead of asking them to click.
3. Read production directly — the DB URLs are in the template `.env` files.
4. Spawn a cheap subagent for the part you think you lack context for.
5. Pick the reversible option and say which one you picked.

A missing credential, a genuinely destructive action, and a decision only the
user can make are blockers. Nothing else on this list is.

## While it runs

Post a delta, not a heartbeat. "Tick 14, still running" is noise; the user
reads it as nothing happening — which, in the measured cases, it usually was.

- Every milestone, and at least every ~15 minutes: what changed since the last
  note, and the number that moved (rows copied, files swept, checks green).
- If the number has not moved in two consecutive notes, that is not a progress
  note — that is a stall. Say what is stuck and change the approach.
- If the user has to ask "still going?", that is a miss.

Never message another agent's thread to report your own progress, and never
tell peer threads to pause. Their work is not yours to stop.

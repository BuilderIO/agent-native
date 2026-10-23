---
name: verify-execution-lease
description: >-
  Model-check the agent run execution lease and durable step journal with TLA+.
  Use when changing turn lease claim, renew, release, fenced writes, reapers,
  aborts, run pruning, beginAgentExecutionStep and its siblings, or the code
  that dispatches a tool effect after markAgentExecutionStepDispatched.
scope: dev
---

# Verify the execution lease

`verification/execution-lease/ExecutionLease.tla` models one turn's execution
lease, its runs, and one durable execution step. TLC checks it exhaustively for
three runs. The promise it guards:

- **P8.** A step whose replay policy is `never` runs its external effect at
  most once, across every run and lease generation, including deposed workers
  that keep running. If this breaks, an email or a non-idempotent write goes
  out twice after a crash or takeover.
- **P1.** Only the owner of the current live lease generation commits writes
  to `agent_execution_steps`.
- **P6** (no resurrection) and **ClaimRespectsLiveOwner** guard the lease
  itself.

P8 is per step row. It assumes every retry of a call reaches the same step id;
whether a re-planned call does is the tool-call journal's job, which the model
does not cover (NOTES.md, "Outside the model").

`verification/execution-lease/NOTES.md` has the assumptions, the bounds, what
is left out, the results, the known findings, and a code-to-action map.

## Run it

```bash
pnpm verify:execution-lease
```

- Needs Java 11 or newer (`brew install openjdk@21`, or any `java` on PATH). The
  first run downloads the pinned TLA+ tools to `.tmp/tla/` and checks their
  sha256.
- About 3 to 5 minutes. `--quick` runs only the two checks (2 to 3 minutes).
- Exit 0: every check passed, every mutation still fails, every known finding
  still reproduces, and no covered function changed.
- Exit 1: one of those did not hold; the output names it.
- Exit 2: could not run (no Java, tools not verified, TLC error). Never read
  exit 2 as a pass.

## When your change touches covered code

`manifest.json` lists the covered code with a hash of each entry, recorded at
`coverage.syncCommit`: named functions, plus anchored regions (`from`/`to`
exact strings) for logic that lives inside a large closure. If you edit one,
the runner fails with "covered code changed"; if an anchor no longer matches
exactly once, it exits 2 until you update the anchors.

1. Find the function's model action in the NOTES.md map and re-read both.
2. If the protocol changed, change the action so it matches the code. Keep one
   action per real transaction, the guard equal to the code's WHERE clause and
   checks, and the cited file:line current.
3. Run `pnpm verify:execution-lease`.
4. Only once the model describes the new code, run
   `pnpm verify:execution-lease --update-coverage` to move the sync commit.

## Reading a failure

A violation in `ExecutionLease.cfg` or `ExecutionLeasePolicyFlip.cfg` is
either a real bug or a modelling error. Walk the TLC trace step by step
against the cited code.

- If every step is something the code can do, it is a bug. Report it as a
  numbered sequence in the code's words.
- If a step is impossible in the code, fix that action's guard to match the
  code.
- Never weaken P8, P1, P6 or ClaimRespectsLiveOwner, never drop a mutation,
  and never shrink the bounds just to get a pass.

A mutation that stops failing means the check has lost the ability to catch
that break. Fix the model before anything else.

## Known findings

`findings/` holds configs that reproduce real gaps in the current code (F2,
F3; F1 and F4-F6 are code-reading findings). They are expected to fail. When one is
fixed, the runner reports that it no longer reproduces. Move its config into
`checks` in `manifest.json` and update NOTES.md.

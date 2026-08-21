---
"@agent-native/core": patch
---

Address review findings across the background-run hardening stack.

- **A recovered `run_timeout` boundary had nothing left to continue with.** The
  run manager armed a soft-timeout timer on the same wall the agent-loop wrapper
  already races with its own cumulative per-round budget, so it fired exactly
  when the wrapper had no budget left — a boundary recoverable in name only, and
  the tail of the automation's budget reachable by nothing. The run manager no
  longer arms that timer for a caller that recovers boundaries in-invocation:
  one wall, one clock, with the caller's hard abort still behind it. The
  wind-down headroom drops from 60s to 20s now that it covers wind-down only.
- **A hard-aborted run was reported as `canceled`**, byte-identical to a user
  pressing Stop, which is what made it indistinguishable in `$ai_error`. The
  wrapper now reports the server-owned abort reason as a `failed` outcome with
  that reason as its code — matching what the no-timeout path already did — so
  the code reaches `$ai_error` through the existing path. This replaces the
  bespoke automation-only classifier, which is deleted.
- **The turn-run ledger allowed one row past its documented ceiling.** Both call
  sites compared `turnRunCount > budget` while the current run's row was already
  counted and the successor's is inserted after. Replaced by a
  `turnRunLedgerExhausted()` predicate so the two sites cannot disagree about
  the boundary again.
- **The background no-progress default is clamped to the chunk it guards.** A
  deployment lowering the global `runSoftTimeoutMs` shrank the chunk without
  shrinking the backstop, leaving it unreachable. Unchanged at shipped values.
- **Trace finalization can no longer alter the run it observes.** Assembly ran
  unguarded inside a `finally`, where a throw replaces the block's result — so a
  malformed payload could report a completed run as failed. Now guarded and
  reported as its own error.
- Fixes a stale trigger-dispatcher assertion left failing by the `dispatch_mode`
  change.

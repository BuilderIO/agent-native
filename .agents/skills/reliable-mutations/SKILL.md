---
name: reliable-mutations
description: >-
  How the agent must perform writes so they actually persist under the hosted
  foreground run budget and long-running background handoffs. Use whenever you
  create, update, delete, or batch-write app data — especially "do this for many
  items" loops, or any task where the user expects N things to end up saved.
---

# Reliable Mutations

## Rule

Make a change in **one atomic call** when the action supports it, then **verify
the persisted end state and report concrete proof** (counts/ids). Never drive a
multi-step change by looping many small writes, and never report success from a
tool ✓ alone.

## Why

Hosted foreground agent runs have a short soft budget so they can hand off
cleanly under synchronous serverless walls. Durable background runs get a much
longer budget, but they still should not rely on loops of many small writes:
continuations can retry the same intent and leave partial state if each item is
committed separately. One atomic call commits or fails as a unit; verification
turns a hopeful ✓ into a fact.

## How

1. **Prefer a single atomic call.** If an action accepts the whole set (add
   many, set all, bulk update), pass the full batch in one call so it commits
   atomically. Check the action surface for a batch/plural form before reaching
   for a loop.
2. **Do not loop many small writes under any run budget.** A sequence of N
   per-item writes can still leave partial or no state when a foreground run
   hands off, a background run continues, or an upstream provider fails. If no
   batch action exists, that is a gap in the action layer — add or extend an
   action that accepts the batch (see the `actions` skill) rather than papering
   over it with a loop.
3. **Verify the end state after writing.** Re-read the data (a list/read action,
   a count query) and confirm the result matches intent — the right number of
   rows, the expected ids/fields. Do this before you tell the user it worked.
4. **Report proof-of-done, not vibes.** State concrete evidence: "saved 12 of 12
   panels (ids …)" or "updated 5 rows". Do not infer success from the presence
   of a tool ✓ on an individual call.
5. **On a time-budget cutoff, fail loud.** If the turn is cut before the change
   is fully committed and verified, say so explicitly and report what *did*
   persist (M of N) and what remains. Never round a partial or unverified write
   up to "done".

## Don't

- Don't loop `for each item: write(item)` for a large set in a single hosted
  turn.
- Don't claim completion because every tool call returned ✓ — a ✓ on an aborted
  chunk does not mean the row was committed.
- Don't silently shrink the scope ("I added a few of them") and present it as the
  finished task.
- Don't try to "fix" this by asking for a longer run timeout — the budget is
  correct; restructure the write instead.

## Related

- `actions` — define or extend a batch/atomic action when only per-item writes
  exist.
- `storing-data` — where app data lives and how reads/writes are scoped.
- `performance` — avoid query waterfalls when verifying end state.
- Design doc: `packages/core/docs/design/durable-agent-runs.md` — the real
  ceiling fix (checkpointed and durable runs); this skill is the agent-facing
  mitigation that reduces how often the ceiling is hit.

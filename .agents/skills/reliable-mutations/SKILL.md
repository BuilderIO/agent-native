---
name: reliable-mutations
description: >-
  How the agent must perform writes so they actually persist under the hosted
  ~40s run budget. Use whenever you create, update, delete, or batch-write app
  data — especially "do this for many items" loops, or any task where the user
  expects N things to end up saved.
---

# Reliable Mutations

## Rule

Make a change in **one atomic call** when the action supports it, then **verify
the persisted end state and report concrete proof** (counts/ids). Never drive a
multi-step change by looping many small writes, and never report success from a
tool ✓ alone.

## Why

Hosted agent runs have a ~40s soft budget (it exists to hand off cleanly under
the upstream gateway/function walls — it is correct and is not raisable; see the
durable-agent-runs design doc). When you loop many sequential writes inside one
turn, the budget can cut you off mid-loop. The run resumes in a new chunk, but
the resume often re-does earlier steps instead of advancing, so the loop churns
and the *saved* result ends up partial — or empty — even though each individual
tool call appeared to succeed. The user gets told "done" while the data says
otherwise. One atomic call commits or fails as a unit; verification turns a
hopeful ✓ into a fact.

## How

1. **Prefer a single atomic call.** If an action accepts the whole set (add
   many, set all, bulk update), pass the full batch in one call so it commits
   atomically. Check the action surface for a batch/plural form before reaching
   for a loop.
2. **Do not loop many small writes under the run budget.** A sequence of N
   per-item writes in one turn will race the ~40s cutoff and can leave partial
   or no state. If no batch action exists, that is a gap in the action layer —
   add or extend an action that accepts the batch (see the `actions` skill)
   rather than papering over it with a loop.
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

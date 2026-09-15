---
name: plan-version-history
description: >-
  DB-backed plan snapshots: when they are taken, how to list and inspect them,
  and what `restore-plan-version` preserves. Use when the user asks about plan
  history, undo, rollback, or restoring an earlier version of a plan.
---

# Plan Version History

- Plans keep DB-backed snapshots before meaningful authoring changes. Pure
  comments, feedback replies, and comment status changes do not create history
  snapshots.
- Use `list-plan-versions` to see saved snapshots for a plan, and
  `get-plan-version` to inspect one full snapshot before recommending a
  rollback.
- Use `restore-plan-version` only when the user asks to restore or roll back.
  The current plan is snapshotted first with `Before restore`, so restore is
  reversible. Restore preserves sharing, ownership, hosted publish metadata,
  comments, and activity history; it restores the plan's authoring content and
  legacy sections.

## Related Skills

- **plan-hosted-writes** — the write protocol that triggers snapshots.

---
record_type: "capability"
spec_version: 2
id: "content.job.durable"
name: "Durable Content jobs"
user_promise: "Long-running import, export, sync, and enrichment work survives interruption and tells the truth about partial progress."
primary_user_job: "Start substantial Content work, leave it safely, and later resume or repair it without duplicates or a false completed state."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.event.committed", "content.agent.action-parity"]
related_features:
  [
    "content.feature.capture-into-action",
    "content.feature.collect-structured-input",
    "content.feature.move-without-starting-over",
    "content.feature.take-the-whole-vault-with-you",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Durable jobs persist an authorized immutable intent, checkpoints, item outcomes, cancellation and recovery state; retries are idempotent and completion is reported only after the declared closure is terminal."
proof_requirements:
  [
    "Persistence, lease, checkpoint, idempotency, cancellation, resume, and duplicate-delivery tests",
    "Authorization, bounded payload, progress visibility, partial-failure, and receipt tests",
    "Interrupted import or export workflow resumed through the real interface",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Durable Content jobs

## Why this exists

Large work needs a memory longer than a browser tab.

## Example workflow

An administrator exports an authorized vault, closes the browser midway, returns later, and resumes from checkpoints. The report distinguishes exported, skipped, failed, and still-pending objects.

## Product contract

- A job persists authorized intent, stable idempotency keys, declared scope, checkpoints, leases, item outcomes, and receipts outside a request lifetime.
- Workers re-check access and freshness at safe boundaries. Retry cannot duplicate accepted effects.
- Progress is granular enough to repair partial failure. Cancelled, paused, queued, failed, conflicted, and complete are different states.
- Completion means the declared work reached terminal item outcomes; a truncated run never masquerades as success.

## Boundaries and non-goals

Individual Actions own domain semantics; jobs provide orchestration, not a second mutation policy. This is not an unbounded background-agent channel.

## Acceptance stories

### Resume without duplicates

Given an import stops after accepted items, when it resumes with the same job identity, then it continues at the checkpoint and does not create duplicate Pages or memberships.

### Report a partial export honestly

Given one authorized asset cannot be resolved during export, when the job finishes, then the package report identifies that unresolved item and the job is not presented as a complete archive.

## Current evidence

Donor evidence: Builder source execution and refresh actions include progress and recovery-focused tests, including `actions/execute-builder-source-execution.test.ts`. No shared durable job substrate proves all Content workloads; this record remains `approved_shape`.

## Proof plan

1. Define persisted job, item, checkpoint, lease, and receipt models.
2. Test interruption, retries, authorization changes, cancellation, and partial failure.
3. Verify a real large import or export resume and conversion report.

## Open questions

- Queue backend and retention policy remain open while preserving portable job semantics.

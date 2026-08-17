---
record_type: "capability"
spec_version: 2
id: "content.form.shared-engine"
name: "Shared Form engine"
user_promise: "Content Form Views and Agent Native Forms use one schema, validation, permission, and idempotent submission engine."
primary_user_job: "Collect structured input once with the same contract whether it arrives from a Form View, an embedded Form, or an agent."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.property.constraints",
    "content.agent.action-parity",
    "content.event.committed",
  ]
related_features: ["content.feature.collect-structured-input"]
roadmap_boundary: "feature"
acceptance_summary: "Form schemas define typed fields, validation, permission, submission target, idempotency, and receipts."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Shared Form engine

## Why this exists

A question should not become less trustworthy because it appears in an embed instead of a Form View. One submission contract keeps duplicate and invalid input honest.

## Example workflow

A requester submits an intake Form from an embed. The same schema validates it as the internal Form View, rejects a duplicate idempotency key, and creates one canonical record with an Event.

## Product contract

Form schemas define typed fields, validation, permission, submission target, idempotency, and receipts. Content Form Views, Agent Native Forms, and agents call one submission Action.

## Boundaries and non-goals

Property constraints own field rules and Events own committed receipts. This is not a second forms datastore, raw endpoint bypass, or a promise that every form is public.

## Acceptance stories

### Return the original receipt on retry

Given the same submission is retried, when the idempotency key matches, then Content returns the original receipt and creates no duplicate record.

### Reject a hidden field from an embed

Given an unauthorized field value, when it is submitted from an embed or agent, then shared validation denies it with the same typed failure.

## Current evidence

No complete shared schema, idempotency, cross-surface permission, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Define one schema and submit it from Form Views, embeds, and agents.
2. Test validation, permissions, idempotency, receipts, retries, and target availability.
3. Run keyboard and screen-reader completion flows with rejected-field recovery.

## Open questions

Public-form identity and draft-save policy need design.

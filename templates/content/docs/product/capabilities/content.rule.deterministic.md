---
record_type: "capability"
spec_version: 2
id: "content.rule.deterministic"
name: "Rules"
user_promise: "Event plus typed condition plus action"
primary_user_job: "Define repeatable operational behavior that is explicit, authorized, idempotent, and explainable."
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.event.committed",
    "content.expression.language",
    "content.agent.action-parity",
  ]
related_features:
  [
    "content.feature.when-this-happens-that-follows",
    "content.feature.collect-structured-input",
    "content.feature.capture-into-action",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Rules are versioned subscriptions from committed Events through one expression language to typed Actions."
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

# Rules

## Why this exists

A Rule turns a recurring intention into a visible promise: one committed event, one typed condition, and one authorized action.

A Rule makes an operational promise visible: one committed event, one typed condition, one authorized action.

## Example workflow

A Database update emits a committed Event, a versioned Rule evaluates a typed condition, and an Action assigns a follow-up property once. The receipt identifies the event, Rule version, authority, and outcome.

## Product contract

Rules are versioned subscriptions from committed Events through one expression language to typed Actions. They have owner authority, idempotency, causal receipts, disablement, retries, and visible failures.

## Boundaries and non-goals

Events own committed triggers, expressions own conditions, and Actions own mutations. This is not client-side scripting, hidden retries that look successful, or unrestricted recursive automation.

## Acceptance stories

### Record a duplicate Event delivery

Given the same Event is delivered twice, when a Rule would mutate a record, then idempotency commits at most one canonical effect and records the duplicate receipt.

### Surface an unevaluable condition

Given a Rule condition cannot be evaluated, when its source is unavailable, then Content records an explicit failure or retry state rather than an empty successful run.

## Current evidence

Rule substrate is in progress, but complete subscription, idempotency, authority, receipt, and recovery proof is incomplete. This Capability remains `in_progress`.

## Proof plan

1. Test versioned subscriptions from committed Events through typed expressions to Actions.
2. Simulate duplicates, false and unevaluable conditions, retries, recursion, and disablement.
3. Inspect causal history, owner controls, failure states, reload recovery, and no-success-on-failure.

## Open questions

The initial retry and dead-letter policy need design.

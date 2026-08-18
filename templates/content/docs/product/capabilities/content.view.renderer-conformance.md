---
record_type: "capability"
spec_version: 2
id: "content.view.renderer-conformance"
name: "View renderer conformance"
user_promise: "Every View obeys the same permissions, Actions, agent context, accessibility, persistence, performance, and recovery contract."
primary_user_job: "Move between Views confidently because changing the renderer never changes what I may know, do, recover, or ask an agent to do."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed", "content.view.query"]
related_features: ["content.feature.see-your-information-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "Every renderer consumes canonical access-scoped results and implements shared Actions, agent context, accessible interaction, persisted configuration, bounded performance, and truthful recovery."
proof_requirements:
  [
    "Reusable conformance suite for result, permission, Action, and agent-context parity",
    "Keyboard and assistive-technology, persistence, reload, failure, stale, and recovery fixtures",
    "Representative renderer real-interface and performance-budget workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# View renderer conformance

## Why this exists

Changing how a collection looks must not quietly change its authority. A renderer is a
projection, not a new application hiding behind a pretty icon.

## Example workflow

An editor switches the same Database from Table to Timeline, asks the agent about the
focused result, then reloads. Both surfaces use the same authorized records and Actions;
each preserves only its own presentation settings.

## Product contract

- Every View renders its canonical Database or Query result after access evaluation.
- Renderers use one typed Action and agent-context contract; UI affordances never widen authority.
- Configuration, focused selection, empty, stale, unavailable, denied, and recovery states are explicit.
- Keyboard and assistive-technology access, bounded loading, and persistence are conformance requirements.

## Boundaries and non-goals

Typed renderers and Queries supply common substrate. This does not force identical
layouts, make every renderer writable, or replace renderer-specific product contracts.

## Acceptance stories

### Keep authority while changing renderer

Given a viewer with partial row and field access, when they switch Views, then results,
counts, previews, Actions, exports, and agent context disclose no additional information.

### Recover consistently

Given an unavailable query or a failed mutation, when any conforming View renders it,
then it reports the state and retry or recovery route without presenting empty success.

## Current evidence

Timeline and existing Database renderers provide useful donor paths, but they do not
prove a cross-renderer suite or complete contract. This Capability remains `approved_shape`.

## Proof plan

1. Create reusable fixtures for permissions, results, Actions, agent context, and state transitions.
2. Run keyboard, assistive technology, persistence, recovery, and reload checks per renderer.
3. Measure representative large-result workflows and test unavailable or stale inputs.

## Open questions

The first enforceable conformance-harness API and performance budgets need implementation design.

---
record_type: "capability"
spec_version: 2
id: "content.schedule.constraints"
name: "Schedule constraints"
user_promise: "Planning surfaces detect dependency and date violations, explain them, and apply only explicit policy or accepted repairs."
primary_user_job: "Understand whether a plan conflicts with its dates and dependencies, then choose a visible repair rather than accepting a hidden schedule rewrite."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.relationship.edge",
    "content.time.types",
    "content.expression.language",
  ]
related_features: ["content.feature.plan-work-across-time"]
roadmap_boundary: "feature"
acceptance_summary: "Planning Views evaluate typed date and dependency constraints, explain violations and uncertainty, and apply only explicit policy or accepted canonical repairs."
proof_requirements:
  [
    "Typed date/range and Relationship constraint evaluation, cycle, missing-data, and uncertainty coverage",
    "Access-safe violation disclosure, repair proposal, policy, Action, history, and recovery coverage",
    "Real-interface planning workflow for Timeline composition, unavailable inputs, reload, and assistive access",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Schedule constraints

## Why this exists

Planning needs honest friction: a date conflict should be explainable, not silently “fixed”
by a renderer that decides on behalf of the work.

## Example workflow

A planner moves a task before a blocking task ends. Timeline identifies the violation,
shows the dependency and dates involved, and offers a policy-backed repair only for approval.

## Product contract

- Constraint evaluation consumes canonical typed Relationships, dates, ranges, and expressions.
- Planning Views distinguish violation, uncertainty, missing input, unavailable source, and no conflict.
- A policy may propose repairs; only an explicit accepted shared Action changes canonical records.
- Access applies before constraints, explanations, counts, previews, exports, and agent context.

## Boundaries and non-goals

Dependencies and time types own inputs; Timeline is a consumer. This is not automatic
project management, a hidden date inference system, or a separate scheduler datastore.

## Acceptance stories

### Explain a blocking conflict

Given a task scheduled before an accessible blocker completes, when a planner opens the
planning View, then Content identifies the typed dependency and conflicting dates clearly.

### Refuse a hidden repair

Given a policy offers a later start date, when the planner declines it, then no canonical
date changes; accepting it creates one attributable shared Action and history entry.

## Current evidence

This record remains `exploring`; no complete constraint evaluator or repair contract is
proven by current Timeline donor code.

## Proof plan

1. Test dates, ranges, dependencies, cycles, missing inputs, and uncertainty.
2. Verify access-safe explanations, explicit repair Actions, history, and recovery.
3. Exercise planning UI, Timeline composition, unavailable sources, reload, and accessibility.

## Open questions

The initial constraint policy catalog and repair proposal language remain exploratory.

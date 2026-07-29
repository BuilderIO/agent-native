---
record_type: "capability"
spec_version: 2
id: "content.agent.automation"
name: "Agent-run automation"
user_promise: "AI work composes Event → expression/query → action → mutation → Event"
primary_user_job: "Automate bounded AI work while preserving an accountable owner, visible context, and a recoverable causal chain."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.rule.deterministic", "content.agent.action-parity"]
related_features: ["content.feature.when-this-happens-that-follows"]
roadmap_boundary: "feature"
acceptance_summary: "An agent automation consumes an Event, evaluated expression or Query, scoped context, and typed Action."
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

# Agent-run automation

## Why this exists

AI work can travel farther than its initiator intended. Its boundaries must remain inspectable, stoppable, and attributable.

## Example workflow

A Rule detects a new intake record, prepares an owner-scoped brief, and creates a draft through a shared Action. The run shows its inputs, cost limit, resulting Event, and disable control.

## Product contract

An agent automation consumes an Event, evaluated expression or Query, scoped context, and typed Action. Owner authority, dry run, chain and cost limits, receipts, disablement, and supported Undo apply to every run.

## Boundaries and non-goals

Deterministic Rules own non-AI behavior and Action parity owns mutations. This is not background prompt execution without an owner or an unbounded self-triggering loop.

## Acceptance stories

### Stop a self-triggering chain

Given a run reaches its chain limit, when it would emit another triggering Event, then Content stops it and records an explicit limit receipt.

### Preview an owner-scoped draft

Given a dry run, when the automation evaluates its context, then it returns proposed Actions and changes no canonical object.

## Current evidence

No complete owner, context, limit, dry-run, receipt, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test owner delegation and revocation with bounded context, dry runs, and effect previews.
2. Drive chains through duplicate triggers, limits, Action failure, and disablement.
3. Inspect receipts, retry state, supported Undo, and accessible supervision.

## Open questions

Cost accounting and the first safe context-preview surface need design.

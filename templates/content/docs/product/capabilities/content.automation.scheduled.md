---
record_type: "capability"
spec_version: 2
id: "content.automation.scheduled"
name: "Scheduled automation"
user_promise: "Scheduled queries and recurring heartbeats over current state"
primary_user_job: "Run a bounded recurring check at the intended time without duplicate work or timezone ambiguity."
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.rule.deterministic", "content.time.types"]
related_features: ["content.feature.when-this-happens-that-follows"]
roadmap_boundary: "feature"
acceptance_summary: "One scheduler evaluates bounded current-state Queries with explicit timezone semantics, schedule identity, idempotency keys, retry policy, and causal lineage."
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

# Scheduled automation

## Why this exists

Recurring work should survive restarts, retries, and clock changes. A client timer cannot carry that promise.

## Example workflow

A project owner schedules a weekday overdue-task query in its selected timezone. The scheduler records a causal run, deduplicates a retry, and invokes the ordinary Rule Action once.

## Product contract

One scheduler evaluates bounded current-state Queries with explicit timezone semantics, schedule identity, idempotency keys, retry policy, and causal lineage. Scheduled work uses Rules and shared Actions.

## Boundaries and non-goals

Time types own date semantics and Rules own subscriptions. This is not a client timer, a second queue, or permissionless background execution.

## Acceptance stories

### Deduplicate a repeated schedule window

Given a delayed retry for a scheduled run, when the same schedule window repeats, then idempotency prevents a duplicate mutation and retains the original lineage.

### Run across a daylight-saving boundary

Given a DST transition, when a recurring schedule reaches its local time, then Content applies its declared timezone policy and records the actual run time.

## Current evidence

Current scheduler substrate is in progress, but complete timezone, bounded-query, dedupe, and lineage proof is absent. This Capability remains `in_progress`.

## Proof plan

1. Test timezone recurrence, bounded query windows, schedule edits, pauses, and restart behavior.
2. Simulate duplicate delivery, retries, missed windows, DST, and failed Rules.
3. Verify owner controls, receipts, disablement, and unavailable-state recovery.

## Open questions

The missed-run and DST policy vocabulary needs design.

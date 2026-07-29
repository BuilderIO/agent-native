---
record_type: "capability"
id: "content.rule.deterministic"
name: "Rules"
user_promise: "Event + typed condition + action"
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed","content.expression.language","content.agent.action-parity"]
related_features: ["content.feature.when-this-happens-that-follows","content.feature.collect-structured-input","content.feature.capture-into-action"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: One expression language, versioned subscriptions, authority, idempotency, receipts."
proof_requirements: ["One expression language, versioned subscriptions, authority, idempotency, receipts."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Rules

## Contract

Event + typed condition + action

## Acceptance boundary

A complete proof demonstrates: One expression language, versioned subscriptions, authority, idempotency, receipts.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

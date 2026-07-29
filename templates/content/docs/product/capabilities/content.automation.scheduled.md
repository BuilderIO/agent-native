---
record_type: "capability"
id: "content.automation.scheduled"
name: "Scheduled automation"
user_promise: "Scheduled queries and recurring heartbeats over current state"
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.rule.deterministic","content.time.types"]
related_features: ["content.feature.when-this-happens-that-follows"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: One scheduler, timezone semantics, bounded queries, dedupe and causal lineage."
proof_requirements: ["One scheduler, timezone semantics, bounded queries, dedupe and causal lineage."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Scheduled automation

## Contract

Scheduled queries and recurring heartbeats over current state

## Acceptance boundary

A complete proof demonstrates: One scheduler, timezone semantics, bounded queries, dedupe and causal lineage.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

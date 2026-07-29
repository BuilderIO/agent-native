---
record_type: "capability"
id: "content.agent.automation"
name: "Agent-run automation"
user_promise: "AI work composes Event → expression/query → action → mutation → Event"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.rule.deterministic","content.agent.action-parity"]
related_features: ["content.feature.when-this-happens-that-follows"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Owner authority, scoped context, chain/cost limits, dry run, receipts, undo/disable."
proof_requirements: ["Owner authority, scoped context, chain/cost limits, dry run, receipts, undo/disable."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent-run automation

## Contract

AI work composes Event → expression/query → action → mutation → Event

## Acceptance boundary

A complete proof demonstrates: Owner authority, scoped context, chain/cost limits, dry run, receipts, undo/disable.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

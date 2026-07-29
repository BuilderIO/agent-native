---
record_type: "capability"
id: "content.agent.action-parity"
name: "Agent and UI parity"
user_promise: "Humans and agents use the same operations and visible state"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.durable-foundations","content.feature.when-this-happens-that-follows","content.feature.collect-structured-input","content.feature.work-on-content-inside-another-application"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Per-capability parity/evals; no special Task action engine."
proof_requirements: ["Per-capability parity/evals; no special Task action engine."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent and UI parity

## Contract

Humans and agents use the same operations and visible state

## Acceptance boundary

A complete proof demonstrates: Per-capability parity/evals; no special Task action engine.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

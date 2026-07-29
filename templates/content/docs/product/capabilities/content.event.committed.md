---
record_type: "capability"
id: "content.event.committed"
name: "Committed Events"
user_promise: "Canonical actor-aware committed Event spine"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.durable-foundations","content.feature.collaborate-in-context","content.feature.review-changes-in-place","content.feature.trust-your-connected-sources","content.feature.evolve-systems-safely","content.feature.when-this-happens-that-follows","content.feature.collect-structured-input","content.feature.move-without-starting-over"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Atomic outbox, mutation-path coverage, actor/authority/origin/causality, one runtime."
proof_requirements: ["Atomic outbox, mutation-path coverage, actor/authority/origin/causality, one runtime."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Committed Events

## Contract

Canonical actor-aware committed Event spine

## Acceptance boundary

A complete proof demonstrates: Atomic outbox, mutation-path coverage, actor/authority/origin/causality, one runtime.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

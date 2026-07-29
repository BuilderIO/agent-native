---
record_type: "capability"
id: "content.source.adapters"
name: "Source adapters"
user_promise: "Local folder, Builder, Notion, and future typed source adapters"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "configured"
dependencies: ["content.source.catalog","content.source.sync-policy"]
related_features: ["content.feature.connect-your-sources","content.feature.trust-your-connected-sources","content.feature.bring-your-local-work","content.feature.read-and-annotate-anything","content.feature.cite-what-you-found","content.feature.move-without-starting-over"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Capability declarations, truth policy, provenance, refresh/conflict/write gates."
proof_requirements: ["Capability declarations, truth policy, provenance, refresh/conflict/write gates."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Source adapters

## Contract

Local folder, Builder, Notion, and future typed source adapters

## Acceptance boundary

A complete proof demonstrates: Capability declarations, truth policy, provenance, refresh/conflict/write gates.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

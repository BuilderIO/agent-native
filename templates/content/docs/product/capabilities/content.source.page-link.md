---
record_type: "capability"
id: "content.source.page-link"
name: "Page-linked Sources"
user_promise: "A single Page can bind to one external source item without inventing a separate source architecture."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters","content.object.page"]
related_features: ["content.feature.connect-your-sources"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: A single Page can bind to one external source item without inventing a separate source architecture."
proof_requirements: ["A single Page can bind to one external source item without inventing a separate source architecture."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Page-linked Sources

## Contract

A single Page can bind to one external source item without inventing a separate source architecture.

## Acceptance boundary

A complete proof demonstrates: A single Page can bind to one external source item without inventing a separate source architecture.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

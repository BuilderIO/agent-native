---
record_type: "capability"
id: "content.version.field-history"
name: "Blocks-field revision history"
user_promise: "Every Blocks field preserves attributable comparison and recovery independently of later named Page Versions."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.blocks-field","content.event.committed"]
related_features: ["content.feature.durable-foundations","content.feature.explore-alternatives-safely"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Every Blocks field preserves attributable comparison and recovery independently of later named Page Versions."
proof_requirements: ["Every Blocks field preserves attributable comparison and recovery independently of later named Page Versions."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Blocks-field revision history

## Contract

Every Blocks field preserves attributable comparison and recovery independently of later named Page Versions.

## Acceptance boundary

A complete proof demonstrates: Every Blocks field preserves attributable comparison and recovery independently of later named Page Versions.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

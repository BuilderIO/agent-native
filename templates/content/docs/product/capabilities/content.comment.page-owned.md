---
record_type: "capability"
id: "content.comment.page-owned"
name: "Comments"
user_promise: "Page-owned threaded comments targeting one or several Blocks"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page","content.object.blocks-field"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Preserve authoritative page context across embeds and references."
proof_requirements: ["Preserve authoritative page context across embeds and references."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Comments

## Contract

Page-owned threaded comments targeting one or several Blocks

## Acceptance boundary

A complete proof demonstrates: Preserve authoritative page context across embeds and references.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

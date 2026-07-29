---
record_type: "capability"
id: "content.author.document-editor"
name: "Document editor"
user_promise: "A humane visual document editor with blocks, comments, media, collaboration, and agent co-editing"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page","content.object.blocks-field"]
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Freeze current editor story across editing, reload, collaboration, comments, agent action, and export."
proof_requirements: ["Freeze current editor story across editing, reload, collaboration, comments, agent action, and export."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Document editor

## Contract

A humane visual document editor with blocks, comments, media, collaboration, and agent co-editing

## Acceptance boundary

A complete proof demonstrates: Freeze current editor story across editing, reload, collaboration, comments, agent action, and export.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

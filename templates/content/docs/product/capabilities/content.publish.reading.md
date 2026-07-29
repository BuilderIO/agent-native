---
record_type: "capability"
id: "content.publish.reading"
name: "Public reading"
user_promise: "Shareable/public reading surfaces render the same document truth as the editor/exporter"
kind: "surface"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed","content.access.visibility-closure"]
related_features: ["content.feature.publish-with-confidence"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: SSR/access rules, shared renderer pipeline, metadata, embeds, portable fallbacks."
proof_requirements: ["SSR/access rules, shared renderer pipeline, metadata, embeds, portable fallbacks."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Public reading

## Contract

Shareable/public reading surfaces render the same document truth as the editor/exporter

## Acceptance boundary

A complete proof demonstrates: SSR/access rules, shared renderer pipeline, metadata, embeds, portable fallbacks.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

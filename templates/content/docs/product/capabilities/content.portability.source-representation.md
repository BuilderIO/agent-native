---
record_type: "capability"
id: "content.portability.source-representation"
name: "Portable source representation"
user_promise: "One lossless, provider-neutral Content source representation with humane Markdown as its base"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page","content.object.blocks-field"]
related_features: ["content.feature.bring-your-local-work"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Shared import/export/agent/local-source contract; stable identities and explicit typed extensions; Notion-Flavored Markdown remains an adapter dialect. A general raw-source editing UI is not part of the approved product promise."
proof_requirements: ["Shared import/export/agent/local-source contract; stable identities and explicit typed extensions; Notion-Flavored Markdown remains an adapter dialect. A general raw-source editing UI is not part of the approved product promise."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Portable source representation

## Contract

One lossless, provider-neutral Content source representation with humane Markdown as its base

## Acceptance boundary

A complete proof demonstrates: Shared import/export/agent/local-source contract; stable identities and explicit typed extensions; Notion-Flavored Markdown remains an adapter dialect. A general raw-source editing UI is not part of the approved product promise.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

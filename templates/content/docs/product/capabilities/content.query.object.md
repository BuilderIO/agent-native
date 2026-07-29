---
record_type: "capability"
id: "content.query.object"
name: "Reusable Query objects"
user_promise: "A one-off inline Query can be promoted into a named reusable Content object that behaves like a dynamic Database without owning its source records"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.expression.language","content.access.visibility-closure"]
related_features: ["content.feature.make-the-workspace-yours","content.feature.connect-your-sources","content.feature.work-across-every-workspace","content.feature.sketch-connections-keep-whats-true"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable identity/title/description/access; typed query AST and output schema; variables; views/renderers; reference/embed/template support; catalog discovery; Query-as-source composition with cycle/scale guards; source-owned values and explicit create/write routing."
proof_requirements: ["Stable identity/title/description/access; typed query AST and output schema; variables; views/renderers; reference/embed/template support; catalog discovery; Query-as-source composition with cycle/scale guards; source-owned values and explicit create/write routing."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Reusable Query objects

## Contract

A one-off inline Query can be promoted into a named reusable Content object that behaves like a dynamic Database without owning its source records

## Acceptance boundary

A complete proof demonstrates: Stable identity/title/description/access; typed query AST and output schema; variables; views/renderers; reference/embed/template support; catalog discovery; Query-as-source composition with cycle/scale guards; source-owned values and explicit create/write routing.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

---
record_type: "capability"
id: "content.author.code"
name: "Executable Code blocks"
user_promise: "Powerful inline Code blocks highlight any recognized language and may become isolated, composable mini-sandboxes with compatible renderers and execution runtimes"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block","content.author.media"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Source/Rendered/Console/Split views; page-scoped referenced source tabs; explicit promotion for workspace-reusable code; manual execution plus opt-in preview hot reload; strict no-network sandbox; bounded resources/output; durable run receipts, approved cached outputs, and stale-output state; portable fences and eventual `.ipynb` interoperability. Mermaid is the first built-in renderer."
proof_requirements: ["Source/Rendered/Console/Split views; page-scoped referenced source tabs; explicit promotion for workspace-reusable code; manual execution plus opt-in preview hot reload; strict no-network sandbox; bounded resources/output; durable run receipts, approved cached outputs, and stale-output state; portable fences and eventual `.ipynb` interoperability. Mermaid is the first built-in renderer."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Executable Code blocks

## Contract

Powerful inline Code blocks highlight any recognized language and may become isolated, composable mini-sandboxes with compatible renderers and execution runtimes

## Acceptance boundary

A complete proof demonstrates: Source/Rendered/Console/Split views; page-scoped referenced source tabs; explicit promotion for workspace-reusable code; manual execution plus opt-in preview hot reload; strict no-network sandbox; bounded resources/output; durable run receipts, approved cached outputs, and stale-output state; portable fences and eventual `.ipynb` interoperability. Mermaid is the first built-in renderer.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

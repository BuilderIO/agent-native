---
record_type: "capability"
id: "content.renderer.custom-block"
name: "Custom Blocks"
user_promise: "One Custom Block model for Content-managed and source-backed reusable components, with optional typed props and a strict origin-aware runtime boundary"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed","content.source.adapters"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Managed sandbox bundles, source/provider adapter identity, versioning, slash insertion, permissions, deterministic export fallback; never blindly execute arbitrary external code in hosted Content."
proof_requirements: ["Managed sandbox bundles, source/provider adapter identity, versioning, slash insertion, permissions, deterministic export fallback; never blindly execute arbitrary external code in hosted Content."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Custom Blocks

## Contract

One Custom Block model for Content-managed and source-backed reusable components, with optional typed props and a strict origin-aware runtime boundary

## Acceptance boundary

A complete proof demonstrates: Managed sandbox bundles, source/provider adapter identity, versioning, slash insertion, permissions, deterministic export fallback; never blindly execute arbitrary external code in hosted Content.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

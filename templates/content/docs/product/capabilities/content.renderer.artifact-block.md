---
record_type: "capability"
id: "content.renderer.artifact-block"
name: "Artifact Blocks"
user_promise: "Page-owned one-off HTML/CSS/JS artifact using the Custom Block sandbox format without entering the reusable catalog"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.custom-block"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Empty or typed prop schema, stable asset handles, no ambient data/network access, static export fallback, explicit Save as Custom Block promotion."
proof_requirements: ["Empty or typed prop schema, stable asset handles, no ambient data/network access, static export fallback, explicit Save as Custom Block promotion."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Artifact Blocks

## Contract

Page-owned one-off HTML/CSS/JS artifact using the Custom Block sandbox format without entering the reusable catalog

## Acceptance boundary

A complete proof demonstrates: Empty or typed prop schema, stable asset handles, no ambient data/network access, static export fallback, explicit Save as Custom Block promotion.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

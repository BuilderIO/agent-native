---
record_type: "capability"
id: "content.diff.filtered-review"
name: "Filtered change review"
user_promise: "Accept/reject individual or all visible changes in a filtered set"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.in-place"]
related_features: ["content.feature.review-changes-in-place","content.feature.explore-alternatives-safely"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Filter snapshot semantics, dependent-change safety, event receipts, idempotent apply."
proof_requirements: ["Filter snapshot semantics, dependent-change safety, event receipts, idempotent apply."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Filtered change review

## Contract

Accept/reject individual or all visible changes in a filtered set

## Acceptance boundary

A complete proof demonstrates: Filter snapshot semantics, dependent-change safety, event receipts, idempotent apply.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

---
record_type: "capability"
id: "content.review.code"
name: "Code review"
user_promise: "Review typed code/file changes in the same in-place, filterable, durable-decision interface"
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.in-place","content.author.code"]
related_features: ["content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Portable file/source model, change graph, syntax renderers, authority, AI summaries later."
proof_requirements: ["Portable file/source model, change graph, syntax renderers, authority, AI summaries later."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Code review

## Contract

Review typed code/file changes in the same in-place, filterable, durable-decision interface

## Acceptance boundary

A complete proof demonstrates: Portable file/source model, change graph, syntax renderers, authority, AI summaries later.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

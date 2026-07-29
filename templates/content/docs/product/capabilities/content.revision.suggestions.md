---
record_type: "capability"
id: "content.revision.suggestions"
name: "Suggestions"
user_promise: "Suggested changes as authored pending revisions with accept/reject history"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.in-place","content.history.queryable"]
related_features: ["content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Event/history/diff spine, author/time window, permissions, conflict handling."
proof_requirements: ["Event/history/diff spine, author/time window, permissions, conflict handling."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Suggestions

## Contract

Suggested changes as authored pending revisions with accept/reject history

## Acceptance boundary

A complete proof demonstrates: Event/history/diff spine, author/time window, permissions, conflict handling.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

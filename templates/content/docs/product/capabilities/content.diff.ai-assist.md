---
record_type: "capability"
id: "content.diff.ai-assist"
name: "Agent-assisted review"
user_promise: "AI summaries and guided review for large change sets"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.filtered-review","content.agent.action-parity"]
related_features: ["content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Trustworthy typed change graph and scoped evidence; never bypass review authority."
proof_requirements: ["Trustworthy typed change graph and scoped evidence; never bypass review authority."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent-assisted review

## Contract

AI summaries and guided review for large change sets

## Acceptance boundary

A complete proof demonstrates: Trustworthy typed change graph and scoped evidence; never bypass review authority.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

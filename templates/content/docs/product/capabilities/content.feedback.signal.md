---
record_type: "capability"
id: "content.feedback.signal"
name: "Reactions and Polls"
user_promise: "Structured reactions and option-based Polls live inside the Page Discussion and can render through views or embeds"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.discussion.page","content.access.safe-aggregate"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Many Poll messages per Discussion; at most one featured Poll per Page; stable option identities, response rules, results visibility, close state, access-safe aggregates, anti-abuse, and view/block renderers over the same Poll."
proof_requirements: ["Many Poll messages per Discussion; at most one featured Poll per Page; stable option identities, response rules, results visibility, close state, access-safe aggregates, anti-abuse, and view/block renderers over the same Poll."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Reactions and Polls

## Contract

Structured reactions and option-based Polls live inside the Page Discussion and can render through views or embeds

## Acceptance boundary

A complete proof demonstrates: Many Poll messages per Discussion; at most one featured Poll per Page; stable option identities, response rules, results visibility, close state, access-safe aggregates, anti-abuse, and view/block renderers over the same Poll.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

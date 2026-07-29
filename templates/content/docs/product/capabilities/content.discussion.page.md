---
record_type: "capability"
id: "content.discussion.page"
name: "Page Discussion"
user_promise: "One universal Page Discussion combining threaded collaboration with curated activity context"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page","content.object.blocks-field","content.event.committed"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Page identity, message/thread/reaction primitives, revision cursor, Event/History projection, grouped comment activity, access and notifications; Discussion and Comments appear as distinct modes in one Collaboration rail, alongside separate Info, Annotations, and Versions rails."
proof_requirements: ["Page identity, message/thread/reaction primitives, revision cursor, Event/History projection, grouped comment activity, access and notifications; Discussion and Comments appear as distinct modes in one Collaboration rail, alongside separate Info, Annotations, and Versions rails."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Page Discussion

## Contract

One universal Page Discussion combining threaded collaboration with curated activity context

## Acceptance boundary

A complete proof demonstrates: Page identity, message/thread/reaction primitives, revision cursor, Event/History projection, grouped comment activity, access and notifications; Discussion and Comments appear as distinct modes in one Collaboration rail, alongside separate Info, Annotations, and Versions rails.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

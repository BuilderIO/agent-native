---
record_type: "capability"
id: "content.access.visibility-closure"
name: "Visibility closure"
user_promise: "Traversal, export, embedding, search, and derived results omit inaccessible objects while known direct links return an honest denial."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database","content.access.safe-aggregate"]
related_features: ["content.feature.work-across-every-workspace","content.feature.publish-with-confidence"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Traversal, export, embedding, search, and derived results omit inaccessible objects while known direct links return an honest denial."
proof_requirements: ["Traversal, export, embedding, search, and derived results omit inaccessible objects while known direct links return an honest denial."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Visibility closure

## Contract

Traversal, export, embedding, search, and derived results omit inaccessible objects while known direct links return an honest denial.

## Acceptance boundary

A complete proof demonstrates: Traversal, export, embedding, search, and derived results omit inaccessible objects while known direct links return an honest denial.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

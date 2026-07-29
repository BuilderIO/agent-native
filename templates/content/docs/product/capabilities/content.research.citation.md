---
record_type: "capability"
id: "content.research.citation"
name: "Citations"
user_promise: "A semantic citation references a durable source record plus an optional locator, independently of how it is rendered"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference","content.knowledge.links"]
related_features: ["content.feature.cite-what-you-found"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable source identity; page/section/time/range locators; one-click promotion from ordinary link; CSL-compatible style rendering; footnote, author-date, numeric, linked-blog, and bibliography presentations; access and round-trip behavior."
proof_requirements: ["Stable source identity; page/section/time/range locators; one-click promotion from ordinary link; CSL-compatible style rendering; footnote, author-date, numeric, linked-blog, and bibliography presentations; access and round-trip behavior."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Citations

## Contract

A semantic citation references a durable source record plus an optional locator, independently of how it is rendered

## Acceptance boundary

A complete proof demonstrates: Stable source identity; page/section/time/range locators; one-click promotion from ordinary link; CSL-compatible style rendering; footnote, author-date, numeric, linked-blog, and bibliography presentations; access and round-trip behavior.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

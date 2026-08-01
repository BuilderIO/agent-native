---
record_type: "capability"
spec_version: 2
id: "content.research.annotation"
name: "Annotations"
user_promise: "Highlights, excerpts, and research notes remain anchored to the exact material and revision they interpret."
primary_user_job: "Mark a precise passage or moment, add meaning, and find it later without pretending an edited source is unchanged."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference", "content.version.field-history"]
related_features:
  [
    "content.feature.explore-alternatives-safely",
    "content.feature.read-and-annotate-anything",
    "content.feature.sketch-connections-keep-whats-true",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Annotations are durable anchored contributions with purpose distinct from comments, stable text/page/region/time selectors, source representation and named Version/revision context, explicit visibility, relocation and orphan states, and searchable projections."
proof_requirements:
  [
    "Selector, revision/version, visibility, persistence, and anchored-contribution data tests",
    "Edit relocation, orphan repair, parallel-version, source-adapter, export, and access tests",
    "Reader and annotation-rail workflow with search, filtering, re-anchor, and shared/private scope",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Annotations

## Why this exists

An annotation is evidence of attention, not a comment that happens to sit near a sentence.

## Example workflow

A researcher highlights a paragraph on a named Version, writes a private note, later searches the Annotation rail, and chooses whether to carry a repaired anchor to a new Version.

## Product contract

- Annotations share an anchored-contribution substrate with Comments and revision notes but retain their own purpose and lifecycle.
- Each records source representation, selector, named Version and exact revision context where available, author, scope, and provenance.
- Quiet in-content marks open to a searchable, filterable Annotation rail; annotations can project to Databases and Canvas without becoming copies.
- Ordinary edits attempt relocation. Unresolved anchors are explicit orphan/repair states; parallel Versions never silently merge annotation meaning.

## Boundaries and non-goals

Reader owns reading interaction; citations own formal source references; comments own feedback threads. An Annotation is not automatically public, shared, or portable to an incompatible source.

## Acceptance stories

### Preserve an exact revision anchor

Given a highlight on a named Page Version, when that Page later changes, then the Annotation retains its original revision context and either relocates with evidence or appears as needing repair.

### Respect private scope

Given a private Annotation on a shared Page, when another collaborator opens the Page or an aggregate, then the Annotation and any derived count are not exposed.

## Current evidence

Donor evidence: anchored Comments and revision history provide related primitives. No durable Annotation object, rail, revision-aware selector, or carry-forward proof exists; this record remains `approved_shape`.

## Proof plan

1. Define anchored contribution and multimodal selector models.
2. Test scope, edits, orphaning, re-anchor, parallel Versions, exports, and access-safe projections.
3. Verify Reader highlight-to-rail-to-repair workflow.

## Open questions

- Automatic relocation confidence thresholds and batch carry-forward UI remain open.

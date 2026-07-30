---
record_type: "capability"
spec_version: 2
id: "content.presentation.mode"
name: "Presentation mode"
user_promise: "Pages and ordered records can present through shared Slides primitives without creating slide-only content."
primary_user_job: "Present existing Content in a focused sequence without copying it into a separate slide document."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.layout.responsive", "content.renderer.typed"]
related_features: ["content.feature.build-living-dashboards"]
roadmap_boundary: "feature"
acceptance_summary: "Presentation mode sequences canonical Pages or ordered records through shared slide primitives while preserving source identity, access, and ordinary editing."
proof_requirements:
  [
    "Source selection, ordering, navigation, speaker-focus, and configuration persistence coverage",
    "Canonical edit, access, sharing, export, reload, and recovery coverage",
    "Real-interface keyboard, assistive-technology, responsive, and embedded presentation workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Presentation mode

## Why this exists

Presenting should reveal a useful sequence, not ask people to maintain a shadow copy of
their work in a slide-only silo.

## Example workflow

An editor presents an ordered set of Pages, advances with the keyboard, and corrects a
fact through the ordinary Page editor. The next presentation uses that canonical change.

## Product contract

- Presentation mode is a View configuration over canonical Pages, Blocks, or ordered records.
- Sequence, focus, and presenter controls are presentation state; source content retains identity and access.
- Edits, sharing, export, and agent context use the same object and Action boundaries as ordinary Content.
- Empty, unavailable, denied, and stale source states are visible rather than replaced by a blank deck.

## Boundaries and non-goals

Responsive layout supplies primitives. Presentation mode is not a slide-only document
type, an animation authoring suite, or a bypass around source permissions.

## Acceptance stories

### Present canonical pages

Given ordered authorized Pages, when a presenter enters presentation mode, then each
slide reflects the canonical source and a viewer sees only Pages they may access.

### Edit without forking

Given a visible slide, when an editor changes its source Page, then the source history
records one ordinary edit and the presentation refreshes without a duplicate slide copy.

## Current evidence

No complete Slides primitive or cross-surface proof is recorded. This Capability remains
`approved_shape`.

## Proof plan

1. Test source selection, ordering, presenter navigation, persistence, and source mutation.
2. Verify access, sharing, export, agent context, stale state, and recovery.
3. Exercise keyboard, screen-reader, responsive, embedded, and reload workflows.

## Open questions

Speaker notes and transition scope need separate design without changing source truth.

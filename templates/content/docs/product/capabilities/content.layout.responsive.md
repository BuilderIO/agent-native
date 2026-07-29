---
record_type: "capability"
spec_version: 2
id: "content.layout.responsive"
name: "Responsive Page layout"
user_promise: "Pages arrange, resize, and reorder Blocks in columns that remain coherent on smaller screens and in exports."
primary_user_job: "Arrange a Page for the work at hand while retaining readable, accessible content on any supported surface."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.blocks-field", "content.renderer.typed"]
related_features:
  [
    "content.feature.build-living-dashboards",
    "content.feature.work-on-content-inside-another-application",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Page layout stores responsive Block arrangement separately from Block content and renders coherent, accessible columns across supported sizes and exports."
proof_requirements:
  [
    "Column create, resize, reorder, persistence, conflict, and recovery coverage",
    "Responsive, embed, export, keyboard, and assistive-technology coverage",
    "Shared Action authorization, history, and canonical Block identity coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Responsive Page layout

## Why this exists

Pages need room to breathe on a wide screen without becoming a pile of clipped fragments
on a narrow one.

## Example workflow

An editor arranges live Blocks in two columns, reorders one, then opens the Page on a
smaller screen. The readable order is preserved; each Block remains its canonical content.

## Product contract

- Layout stores arrangement and responsive rules separately from canonical Blocks and their content.
- Authorized edits use shared Actions, history, recovery, and concurrent-change behavior.
- Small surfaces and exports use a deterministic readable order, not hidden or duplicated content.
- Keyboard and assistive technology can inspect and change supported layout operations.

## Boundaries and non-goals

Blocks fields own content. This is not a freeform Canvas, slide engine, or alternate Page
identity.

## Acceptance stories

### Reflow a column layout

Given a two-column Page, when a viewer opens it on a narrow surface, then Blocks appear
once in a readable deterministic order without inaccessible overflow.

### Keep Blocks canonical

Given an editor reorders a Block, when another authorized View opens the Page, then it
observes the same Block identity and changed layout without copied content.

## Current evidence

The product boundary is shaped, but no complete layout, responsive, export, and recovery
proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test layout edits, persistence, undo, conflicts, and canonical Block identity.
2. Test responsive and embed/export rendering across supported breakpoints.
3. Exercise keyboard, screen reader, permission, reload, and failure recovery workflows.

## Open questions

The initial supported layout primitives and export fidelity thresholds need design.

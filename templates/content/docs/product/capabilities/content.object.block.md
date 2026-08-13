---
record_type: "capability"
spec_version: 2
id: "content.object.block"
name: "Blocks"
user_promise: "A Block is a stable addressable unit of rich content inside its owning field."
primary_user_job: "Edit and point to a meaningful part of content without fragile position-only anchors."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: []
related_features:
  ["content.feature.durable-foundations", "content.feature.living-references"]
roadmap_boundary: "feature"
acceptance_summary: "Every rich-content Block keeps a stable identity through edits, reordering, deletion, recovery, references, and Page-owned collaboration anchors."
proof_requirements:
  [
    "Stable Block IDs across text and structured edits, reorder, deletion, and recovery",
    "Reference serialization and rendering resolve by ID with access checks",
    "Comment anchors retain historical target context",
    "Shared Action/UI editing, conflict, undo, and reload behavior",
  ]
evidence:
  ["shared/blocks-field-identity.ts", "actions/blocks-seeding.db.test.ts"]
superseded_by: null
last_reviewed: "2026-08-10"
---

# Blocks

## Why this exists

People comment on a paragraph, reuse a callout, and return to an exact idea. Positional text ranges alone drift; stable Blocks give those gestures a durable address.

## Example workflow

An editor moves a callout above a heading while a reviewer comments on it and another Page references it. The callout keeps its identity; the comment and reference still lead to the same material or its authorized historical context.

## Product contract

- A Block is a stable, typed content unit owned by one Blocks field; it is not a Page.
- Editing text or typed props and reordering Blocks preserve identity whenever the logical Block survives.
- References store Block identity, not renderer position. Comments remain Page-owned while targeting one or more Block anchors.
- Deletion records an attributable historical target; recovery never silently reassigns an old anchor to unrelated new text.
- One Action surface applies validation, access, Events, and concurrency behavior for people and agents.

## Boundaries and non-goals

- Blocks do not own independent Page access, Database membership, or top-level Properties.
- A Block reference is not automatically a synced editable transclusion.
- Blocks-field history owns the field revision sequence; this record owns the stable local unit.

## Acceptance stories

### Keep the comment on the intended material

Given a comment anchored to a Block, when the Block is reordered and edited, then the anchor follows that Block. When it is deleted, then the comment opens authorized historical context rather than a similarly placed replacement.

### Resolve a reference safely

Given a Block reference in another Page, when an authorized reader opens it, then it resolves the canonical Block. When access is lost, then the renderer degrades without exposing its content.

## Current evidence

Database Blocks fields now have a field-scoped ordered identity sidecar with deterministic legacy IDs, persisted revisions, and bounded tombstone recovery. Deterministic tests cover editing, reorder, insertion, deletion, recovery, reload, and field independence. Agent-facing exact Block actions, reference/comment anchors, actor-aware history, and real-interface proof remain incomplete, so this is `in_progress`, not verified.

## Proof plan

1. Test typed Block creation, edit, split, merge, move, deletion, restore, and undo.
2. Verify comment, reference, and history anchors through each operation and reload.
3. Exercise concurrent edits and stale restore through UI and shared Actions.
4. Test inaccessible, unknown-renderer, and portable-export degradation.

## Open questions

Storage encoding and identity assignment timing remain implementation choices, provided logical Block identity and historical anchors survive.

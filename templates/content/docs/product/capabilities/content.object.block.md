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
  [
    "shared/blocks-field-identity.ts",
    "shared/blocks-field-identity.spec.ts",
    "actions/blocks-seeding.db.test.ts",
    "actions/content-database-block-actions.db.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-11-08"
---

# Blocks

## Why this exists

People comment on a paragraph, reuse a callout, and return to an exact idea. Positional text ranges alone drift; stable Blocks give those gestures a durable address.

## Example workflow

An editor moves a callout above a heading while a reviewer comments on it and another Page references it. The callout keeps its identity; the comment and reference still lead to the same material or its authorized historical context.

## Product contract

- A Block is a stable, typed content unit owned by one Blocks field; it is not a Page.
- Editing text or typed props and reordering Blocks preserve identity whenever the logical Block survives.
- Block identity lives in the field's identity sidecar beside the body, never in the saved body text, so Markdown, export, and synced copies carry no Block IDs. Each save matches Blocks again by exact caller IDs, identical content, the first part of a split or merge, similar text, and finally a Block rewritten in place between the same kept neighbors under the same parent. A Block that none of these tells apart gets a new ID; the earlier Block it might have been becomes a tombstone.
- References store Block identity, not renderer position. Comments remain Page-owned while targeting one or more Block anchors.
- Deletion records an attributable historical target; recovery never silently reassigns an old anchor to unrelated new text.
- One Action surface applies validation, access, Events, and concurrency behavior for people and agents.

## Boundaries and non-goals

- Blocks do not own independent Page access, Collection membership, or top-level Properties.
- A Block reference is not automatically a synced editable transclusion.
- Blocks-field history owns the field revision sequence; this record owns the stable local unit.

## Acceptance stories

### Keep the comment on the intended material

Given a comment anchored to a Block, when the Block is reordered and edited, then the anchor follows that Block. When it is deleted, then the comment opens authorized historical context rather than a similarly placed replacement.

### Resolve a reference safely

Given a Block reference in another Page, when an authorized reader opens it, then it resolves the canonical Block. When access is lost, then the renderer degrades without exposing its content.

## Current evidence

Collection Blocks fields now have a field-scoped ordered identity sidecar with deterministic legacy IDs, persisted revisions, and bounded tombstone recovery. Exact collection-row actions list stable Blocks and apply supported insert, update, upsert, delete, and same-parent reorder operations with schema, row, and field conflicts plus durable retry receipts. Deterministic tests cover sibling preservation, operation capabilities, deletion, recovery, reload, and field independence. Body saves without caller IDs re-match by content and place; tests prove that a save which deletes one paragraph and rewrites another, moves and rewrites one, or edits a list item never hands a deleted Block's ID to other text. Reference/comment anchors, actor-aware history, other Blocks-field owners, and real-interface proof remain incomplete, so this is `in_progress`, not verified.

## Proof plan

1. Test typed Block creation, edit, split, merge, move, deletion, restore, and undo.
2. Verify comment, reference, and history anchors through each operation and reload.
3. Exercise concurrent edits and stale restore through UI and shared Actions.
4. Test inaccessible, unknown-renderer, and portable-export degradation.

## Open questions

Storage is settled in the Product contract: the sidecar, not in-text IDs, because in-text video IDs needed duplicate-ID checks on every write path, fresh IDs on paste and duplicate, and rematching after source pulls. Still open is when the editor should hand its own saves exact Block IDs instead of relying on matching; that waits for the first feature that links to a single Block, since agent Markdown edits would still be matched.

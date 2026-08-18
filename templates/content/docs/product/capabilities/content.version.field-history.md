---
record_type: "capability"
spec_version: 2
id: "content.version.field-history"
name: "Blocks-field revision history"
user_promise: "Every Blocks field preserves attributable comparison and recovery independently of later named Page Versions."
primary_user_job: "Understand, compare, and recover how any rich-content field changed without turning every edit into a named alternative."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.blocks-field", "content.event.committed"]
related_features:
  [
    "content.feature.durable-foundations",
    "content.feature.explore-alternatives-safely",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Every editable Blocks field retains stable Block identity, attributable causal Revisions, comparison, and recovery across ordinary editing and named-Version operations."
proof_requirements:
  [
    "Independent attributable revision history for every Blocks field",
    "Stable Block and field identity through edits, reorder, deletion, and recovery",
    "Causal Revision grouping distinct from Events, snapshots, and named Versions",
    "In-place comparison and recovery through UI and shared Actions",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Blocks-field revision history

## Why this exists

Rich content appears in Page bodies, additional Blocks Properties, Comments, Discussion messages, annotations, and other Content objects. People need to know what changed and recover mistakes in any of those bodies without making every keystroke a named Version or every field a miniature Page.

## Example workflow

A Page contains a primary article body and a separate research-notes Blocks field. An agent edits both in one run. The editor can inspect each field's attributable history, compare the relevant Revisions in place, and restore only the research notes without replacing the article body, Page title, or Properties. If the Page later gains named Versions, each alternative continues to retain its own field history.

## Product contract

- Every editable rich-content body is a Blocks field with stable identity and one canonical owning object.
- Every Block retains stable identity through ordinary text edits, structured edits, and reordering. Deleted content remains addressable through authorized history.
- A committed Event is one atomic fact. A logical Revision groups causally related edits by actor, intent, action, or agent run. A recovery snapshot is persistence machinery. A named Version is a deliberate alternative. The interface never treats these as synonyms merely because they happened near the same time.
- Each Blocks field owns its own attributable revision sequence, comparison, and recovery boundary.
- A single action may causally touch several fields while preserving which changes belong to each field. Restoring one field does not silently replace unrelated Page state.
- History records the actual actor, authority, origin, and causal run. Agent work is attributable as agent work rather than being flattened into the signed-in person's authorship.
- Comparison renders through the ordinary typed editor and renderer for that field. Unknown or unavailable Block renderers preserve their source and produce an explicit degraded state rather than dropping content.
- Creating, promoting, archiving, restoring, or merging a named Page Version never erases the underlying field histories.
- Comments, Annotations, references, and other anchors retain their historical Block/field/Revision targets even when current content changes or is deleted.

## Permissions and failure behavior

- History reads and restores use the owning object's access plus any narrower named-Version boundary.
- A person or agent cannot recover a field into a state they may inspect but lack authority to edit.
- Inaccessible or pruned history is not reported as an empty successful timeline. Known direct references return an honest denial without leaking content.
- A failed restore leaves the current field and its history unchanged. Recovery is one atomic, attributable Revision and can itself be inspected or undone.
- Concurrent current edits cannot be silently overwritten by a restore prepared against an older state; Content exposes a stale/conflict state or applies a contractually safe merge.

## Boundaries and non-goals

- Field history does not create a named Version for every edit.
- Snapshot timing does not decide Revision boundaries; causality and editing intent do.
- A Blocks field is not a full Page and does not acquire independent top-level Properties, sharing, or Database membership.
- This Capability does not define the Page-level branching graph, selective cross-Version merge, or canonical promotion owned by `content.version.branching`.
- Queryable History may project these Revisions across objects, but it is not the source of truth for the field's identity.

## Acceptance stories

### Recover one field without replacing its Page

Given a Page with two Blocks fields and unrelated top-level Properties, when an editor restores an earlier Revision of one field, then only that field changes, the other field and Properties remain intact, and the restore produces a new attributable Revision.

### Preserve anchors after deletion

Given a Comment anchored to a Block range, when the range and then the Block are deleted, then the Comment remains durable and can open the historical field Revision showing the original target rather than being auto-archived or attached to plausible-looking new text.

### Keep agent edits attributable

Given one agent run edits several Blocks in two fields, when a reviewer opens History, then the changes are grouped by causal run while remaining inspectable per field and are attributed to the agent and authorizing context.

### Survive named-Version operations

Given two named Versions with independent edits to the same logical field, when one is promoted and the other archived and restored, then both field histories, Block identities, anchors, and actors remain intact.

## Current evidence

Current whole-document snapshots and restore behavior demonstrate useful recovery substrate. They do not prove independently addressable Blocks-field history, causal Revision grouping, stable Block identity across every edit, cross-field selective recovery, or preservation through named Versions. This Capability remains `approved_shape`.

## Proof plan

1. Exercise text and structured Block edits, moves, deletions, and restores in every Blocks-field-owning object.
2. Verify Event-to-Revision grouping for human, agent, automation, API, and integration actors.
3. Compare and restore one field while other fields, title, Properties, memberships, and concurrent edits remain intact.
4. Verify Comment, Annotation, reference, and execution-receipt anchors before and after edits, deletion, restore, and named-Version operations.
5. Test access denial, stale restore, persistence interruption, Undo, reload, export, and lossless round-trip.
6. Run the workflow through the real editor and shared Actions, including keyboard and assistive-technology inspection.

## Open questions

The remaining major seam is how one named Page Version selects or groups several independently versioned Blocks fields. Physical snapshot cadence, storage layout, compaction, and indexing remain implementation choices as long as the causal and recovery contract survives.

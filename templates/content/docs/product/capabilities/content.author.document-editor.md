---
record_type: "capability"
spec_version: 2
id: "content.author.document-editor"
name: "Document editor"
user_promise: "Write and revise a rich document with blocks, comments, collaboration, media, and agent help in one humane surface."
primary_user_job: "Revise a shared rich document without losing structure or history."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page", "content.object.blocks-field"]
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "The visual editor preserves canonical document content through edits, reloads, collaboration, comments, authorized agent changes, and export."
proof_requirements:
  [
    "One visual document surface edits the canonical Blocks field and retains stable Page and block identity.",
    "Agent proposals use the ordinary action, review, and history path; they are not a private inline editor.",
    "Collaborators see reconciliation and failures honestly rather than silently losing edits.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-09-26"
---

# Document editor

## Why this exists

Writing falls apart when the editor treats structure, comments, collaboration, media, and agent edits as separate temporary surfaces. A Page needs one humane place where those changes remain attributable and recoverable after the tab closes.

## Example workflow

Ravi turns a paragraph into a callout, anchors a Comment, accepts an agent edit, reloads, and finds both the block and comment anchor intact.

## Product contract

- One visual document surface edits the canonical Blocks field and retains stable Page and block identity.
- Agent proposals use the ordinary action, review, and history path; they are not a private inline editor.
- Collaborators see reconciliation and failures honestly rather than silently losing edits.
- Refresh and tab lifecycle saves carry durable editor lineage so stale recovery writes cannot reopen settled work; overlapping local intent wins only within Content's explicit reconciliation policy, with displaced versions retained in History.
- Live editors of one Page share a Yjs document, so each body save is a serialization of that one document. Saves are ordered by the Yjs state vector they were serialized from: a save that has observed the stored body replaces it, a save the stored body already contains is acknowledged without writing, and a save missing a peer's edits syncs and saves again. Live tabs never text-merge against each other, and a stale text base is not a conflict.
- A body written outside the live document (agent, API, restore, sync) is merged into the live document once by the leading editor, even while someone types, and that editor then proves the merge so state-vector ordering resumes. Until then a live save text-merges from the last body its document provably contains, never from a body it only observed; exhausted contention or failed transport keeps the latest draft recoverable with honest save feedback.
- Draft recovery gates only the first mount of a Page. A draft that appears while an editor is live, or a session refetch, never swaps the live editor out.

## Boundaries and non-goals

- `content.object.page` and `content.object.blocks-field` own identity and body history; Comments, media, and agent actions use their own shared contracts.
- This does not add a raw-source editing mode, a second agent composer, or a private inline mutation engine.

## Acceptance stories

### Reconcile collaboration

Given two editors change adjacent text while one is offline, when reconnecting, then no edit is silently lost.

### Export canonical content

Given media, comments, and an agent mutation, when export runs, then visible content reflects the canonical body.

## Current evidence

`app/components/editor/VisualEditor.tsx`, `DocumentEditor.tsx`, `actions/edit-document.ts`, and `actions/update-document.ts` provide revisioned saves, idempotent external edits, and generation-fenced recovery. Beta passes on September 23 (`c0d9e4b97f73`) and September 26 (`214d5f388660`) failed on the third alternating two-tab edit. Local two-tab traces showed why: every tab's save was text-merged against peers whose edits it already held through Yjs, a refused merge stored a recovery draft, and that draft swapped the live editor out of every tab, dropping keystrokes typed during the swap. With state-vector ordering, a local Playwright two-tab run with emulated tab visibility passed repeatedly for alternating, fast-switching, concurrent, and new-paragraph edits, and for MCP `edit-document` calls interleaved with both tabs typing, with canonical and both live editors holding every marker exactly once. `actions/update-document.collab.db.test.ts` covers the server ordering decisions. Hosted beta acceptance is still pending.

## Proof plan

1. Edit rich blocks and media then reload and compare canonical serialization.
2. Test reconnect, anchors, and attribution.
3. Compare UI and Action edits for access/history parity.
4. Export mixed content with declared fallbacks.

## Open questions

The final cumulative R01–R08 real-interface pass and authenticated beta rerun must establish that the repaired session preserves edits, history, cursor, undo, comments, and recovery across delivery and lifecycle orderings.

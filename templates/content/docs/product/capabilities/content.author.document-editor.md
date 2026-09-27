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
last_reviewed: "2026-09-23"
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
- One Page editing session keeps the confirmed SQL snapshot, the currently observed live body, and pending authored intent distinct. Each save attempt carries its matching title/body base and candidate; exact retries keep the same payload-bound identity, while a rebased candidate gets a new attempt identity. Peer Yjs changes update the recoverable view without becoming a new local edit or a save acknowledgement.
- A stale canonical revision is an input to automatic reconciliation. Exhausted contention or failed transport keeps the latest draft recoverable with honest save feedback; only incompatible structure may require explicit recovery. Delayed acknowledgements and lifecycle saves cannot settle newer authored or observed content.

## Boundaries and non-goals

- `content.object.page` and `content.object.blocks-field` own identity and body history; Comments, media, and agent actions use their own shared contracts.
- This does not add a raw-source editing mode, a second agent composer, or a private inline mutation engine.

## Acceptance stories

### Reconcile collaboration

Given two editors change adjacent text while one is offline, when reconnecting, then no edit is silently lost.

### Export canonical content

Given media, comments, and an agent mutation, when export runs, then visible content reflects the canonical body.

## Current evidence

`app/components/editor/VisualEditor.tsx`, `DocumentEditor.tsx`, `actions/edit-document.ts`, and `actions/update-document.ts` provide revisioned saves, idempotent external edits, and generation-fenced recovery. The September 23 authenticated beta pass on deployed `c0d9e4b97f73` failed after three alternating two-tab edits: the saved body missed later edits from one tab and the other tab opened the version-choice dialog. The current save-session repair has passed an early local three-cycle reproduction, ten alternating cycles with canonical read-back, and an independent browser/MCP edit with replay receipt. This is local, in-progress evidence; the final cumulative R01–R08 real-interface pass and repaired hosted beta acceptance are still pending.

## Proof plan

1. Edit rich blocks and media then reload and compare canonical serialization.
2. Test reconnect, anchors, and attribution.
3. Compare UI and Action edits for access/history parity.
4. Export mixed content with declared fallbacks.

## Open questions

The final cumulative R01–R08 real-interface pass and authenticated beta rerun must establish that the repaired session preserves edits, history, cursor, undo, comments, and recovery across delivery and lifecycle orderings.

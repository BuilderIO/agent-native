---
record_type: "capability"
spec_version: 2
id: "content.history.queryable"
name: "History"
user_promise: "History is a full-height, access-scoped surface for inspecting and recovering meaningful change."
primary_user_job: "Find what changed, compare it in context, and recover safely without reconstructing the story from notifications."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed"]
related_features:
  [
    "content.feature.durable-foundations",
    "content.feature.review-changes-in-place",
  ]
roadmap_boundary: "feature"
acceptance_summary: "History queries access-scoped Events, logical Revisions, snapshots, and receipts with filters, grouping, typed diffs, and recovery routes while preserving their distinct meanings."
proof_requirements:
  [
    "Access-scoped event/revision/snapshot/receipt query model",
    "Filter, group, sort, and stable permalink behavior",
    "Typed body and property diff plus recovery routes",
    "UI/Action parity, denial, concurrency, and export evidence",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# History

## Why this exists

Collaboration needs an exhaustive place to ask what happened and recover from it. A friendly timeline can summarize, but it cannot quietly become the only evidence.

## Example workflow

An editor filters a Page's History to one agent run, expands its logical Revision into atomic Events, compares a changed Property and Block in their ordinary renderers, then restores only the authorized field.

## Product contract

- History is an access-scoped projection over committed Events, logical Revisions, recovery snapshots, and execution receipts.
- It supports filtering, grouping, sorting, stable links, and typed comparison in the normal Page/Database renderer.
- Events are atomic facts; Revisions are causal review units; snapshots are recovery mechanics; named Versions are deliberate alternatives. History preserves those distinctions.
- Recovery invokes shared Actions and creates attributable new change rather than rewriting the past.
- Inaccessible history is denial or omission according to access context, never a successful empty timeline.

## Boundaries and non-goals

- Discussion is a curated collaboration projection, not the exhaustive recovery authority.
- History does not decide suggestion review disposition or Page Version promotion.
- It does not require every low-level persistence operation to be user-visible.

## Acceptance stories

### Compare a causal Revision in place

Given an agent Revision containing Block and Property changes, when an editor opens it in History, then they can inspect grouped Events and typed diffs in the ordinary surface without losing actor or causal context.

### Recover without leaking another Version

Given a person can read a Revision but lacks authority to edit a narrower Version, when they choose restore, then it is denied and the current content remains unchanged.

## Current evidence

Current document versions, restore actions, and editor history UI demonstrate snapshot-oriented substrate. They do not prove access-scoped Event/Revision queryability, typed diffs, or complete recovery semantics; this remains `approved_shape`.

## Proof plan

1. Query and compare Events, Revisions, snapshots, and receipts across Page, Database, source, and agent work.
2. Test filters, grouping, sort, links, pagination, access changes, and private data closure.
3. Restore fields and whole states under conflict, undo, and concurrent editing.
4. Verify UI and Actions with keyboard and assistive-technology paths.

## Open questions

Retention, compaction, and default grouping are implementation choices as long as authorized history stays attributable and recoverable.

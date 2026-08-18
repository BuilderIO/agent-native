---
record_type: "capability"
spec_version: 2
id: "content.revision.suggestions"
name: "Suggestions"
user_promise: "Suggested changes remain authored pending Revisions until an authorized person accepts, rejects, defers, or supersedes them."
primary_user_job: "Propose reversible human or agent work without mutating the canonical Page before review."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.in-place", "content.history.queryable"]
related_features: ["content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "Suggestions preserve authored pending Revision identity, target/basis, scope, permissions, conflict state, and durable disposition through in-place review and History."
proof_requirements:
  [
    "Pending Revision identity with actor, time, origin, target, basis, and change set",
    "In-place typed review and Event/History disposition",
    "Permission, author edit window, stale basis, and conflict behavior",
    "Human/agent parity, concurrent review, recovery, and notification coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Suggestions

## Why this exists

People and agents need room to offer work before it becomes canonical. A suggestion is a real authored proposal, not an ephemeral chat message or a secret second document.

## Example workflow

An agent proposes edits to an article and its metadata. The proposal remains pending as one authored Revision. The editor accepts stronger passages, rejects an incorrect Property change, leaves another suggestion pending, and can later see every decision in History.

## Product contract

- A Suggestion is a pending logical Revision with stable identity, author, authority/origin, time, targets, observed basis, typed change set, and disposition.
- Human and agent suggestions use one model; neither receives a private document or review path.
- Pending suggestions do not mutate canonical target state until authorized acceptance.
- Author editing follows an explicit time/permission policy and preserves visible history rather than erasing the proposal.
- Acceptance, rejection, deferment, supersession, conflict, and expiry are durable Events/History states.
- A stale target exposes rebase, refresh, or conflict behavior; it never silently applies to a moved target.

## Boundaries and non-goals

- Suggestions are not every Event, snapshot, or named Page Version.
- This record does not define filtered-set review or AI summaries.
- A pending suggestion does not widen access to its target or its underlying evidence.

## Acceptance stories

### Keep a proposal pending until review

Given an agent proposes a Block and Property change, when the proposal is created, then the canonical Page is unchanged and the editor can inspect one attributable pending Revision in place.

### Handle a moved target without overwrite

Given an editor changes a target after a suggestion's observed basis, when another reviewer accepts the suggestion, then Content presents a rebase, refresh, or conflict state and does not silently overwrite the newer canonical change.

## Current evidence

Current document snapshots and source-review machinery provide useful proposed-change donors. The repository does not yet prove generic authored pending Revisions, typed suggestion review, or conflict semantics across Content; this remains `approved_shape`.

## Proof plan

1. Create, edit, submit, accept, reject, defer, supersede, and expire human and agent suggestions.
2. Test author windows, target permissions, access changes, Notifications, History, and recovery.
3. Race concurrent author edits, reviewer decisions, target edits, and retries.
4. Verify typed body/Property/Block rendering through UI and shared Actions.

## Open questions

The exact author edit window and rebase UX remain open. Pending identity, durable disposition, and no-silent-overwrite behavior are settled.

---
record_type: "capability"
spec_version: 2
id: "content.diff.filtered-review"
name: "Filtered change review"
user_promise: "A reviewer can accept or reject one change or an exact visible set without accidentally deciding newer or hidden changes."
primary_user_job: "Review a manageable subset of a large proposal while preserving dependency safety and auditability."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.in-place"]
related_features:
  [
    "content.feature.review-changes-in-place",
    "content.feature.explore-alternatives-safely",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Filtered bulk review snapshots the exact eligible change identities and bases, validates dependencies and authority atomically, and records idempotent decisions without sweeping in concurrent matches."
proof_requirements:
  [
    "Exact filter/selection snapshot semantics",
    "Dependency and mixed-authority preflight",
    "Idempotent atomic apply with durable Event receipts",
    "Concurrent additions, stale changes, retry, undo, and UI/Action coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Filtered change review

## Why this exists

Large change sets need a humane slice, but “accept all visible” must mean exactly what the reviewer saw—not whatever happened to match later.

## Example workflow

An editor filters an agent proposal to changes in one section, selects the visible compatible changes, and accepts them. A new change that arrives while review is open remains pending; a hidden prerequisite is surfaced rather than silently applied.

## Product contract

- A filtered decision resolves exact eligible change IDs, observed bases, and filter context at selection time.
- New matching changes do not enter an already prepared bulk decision.
- Preflight checks dependencies, stale bases, source policy, and authority for the full intended set.
- Mixed permissions or incompatible dependencies produce an explicit repair/narrowing state, never an invisible partial commit.
- Repeated delivery of the same approved decision is idempotent and emits durable receipts.

## Boundaries and non-goals

- This does not decide the typed rendering of a single change or generate proposals.
- It is not a generic Database bulk-edit engine, though both need exact selection semantics.
- Agents may narrow scope only when faithful to the request and must report skipped work.

## Acceptance stories

### Freeze the visible set

Given a reviewer filters to five pending changes, when a sixth matching change arrives before **Accept visible** completes, then only the five resolved IDs are decided and the sixth remains pending.

### Refuse unsafe partial approval

Given a selected change depends on an inaccessible or stale prerequisite, when the reviewer accepts the set, then no subset silently applies and Content explains the dependency or authority repair path.

## Current evidence

Existing source-review and bulk-operation machinery offers useful examples of selection and audit behavior. It does not prove generic filtered review snapshot, dependency, and idempotent decision semantics; this remains `approved_shape`.

## Proof plan

1. Exercise single, selected, filtered, and all-visible decisions across typed change kinds.
2. Race concurrent additions, edits, removals, retries, and duplicate requests.
3. Test dependencies, mixed authority, source locks, stale bases, undo, and Event/History receipts.
4. Verify UI and agent Action parity, accessibility, and clear scope reporting.

## Open questions

Filter language and progress presentation may vary; exact selection snapshot and no-silent-partial behavior may not.

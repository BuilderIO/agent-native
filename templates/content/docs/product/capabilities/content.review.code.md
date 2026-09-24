---
record_type: "capability"
spec_version: 2
id: "content.review.code"
name: "Code review"
user_promise: "Review typed code and file changes in the same in-place, filterable, durable-decision interface"
primary_user_job: "Review a portable code change in context and leave decisions attached to stable files and hunks."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.in-place", "content.author.code"]
related_features: ["content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "Code review uses a portable file/source model, typed change graph, syntax-aware renderers, authority checks, durable in-place decisions, and canonical source provenance."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Code review

## Why this exists

Review decisions need durable anchors that survive refreshes without claiming custody of the underlying repository.

## Example workflow

A reviewer opens a proposed file change, filters to unresolved hunks, leaves an in-place decision, and later reopens the same decision after the source refreshes.

## Product contract

Code review uses a portable file/source model, typed change graph, syntax-aware renderers, authority checks, durable in-place decisions, and canonical source provenance. AI summaries are enhancing work, not a prerequisite claim.

## Boundaries and non-goals

In-place diffs and code authoring own their primitives. This is not a Git-host replacement, provider custody claim, or auto-merge authority.

## Acceptance stories

### Reattach a decision after an unrelated refresh

Given a source refresh changes unrelated lines, when a reviewer reopens a decision, then its stable change anchor either resolves or reports a truthful orphaned state.

### Report an orphaned hunk truthfully

Given a viewer lacking file access, when they open a review, then no code, hunk count, or summary leaks through filters or review metadata.

## Current evidence

This remains `exploring`; no complete portable-source, syntax, authority, and durable-decision proof is recorded.

## Proof plan

1. Test portable file identities, change graphs, syntax rendering, filters, and anchors.
2. Verify decisions, authority, provenance, refresh reconciliation, and inaccessible files.
3. Exercise orphaned hunks, unavailable sources, keyboard review, and diff navigation.

## Open questions

The initial portable file identity and change-anchor strategy remain exploratory.

---
record_type: "capability"
spec_version: 2
id: "content.workspace.view-instance"
name: "View instances"
user_promise: "Tabs, panes, embeds, and windows can show independent focused instances of the same canonical object without duplicating it."
primary_user_job: "Compare or work through the same object in several places while keeping presentation state independent and data canonical."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.working-set", "content.view.query"]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "Independent View instances hold their own focus and presentation state over shared canonical objects, reconcile shared mutations, and render lazily within one bounded working set."
proof_requirements:
  [
    "Two-instance identity, independent View state, focus, selection, and persistence coverage",
    "Shared mutation reconciliation, permission change, close, embed, and recovery coverage",
    "Lazy-rendering, keyboard, assistive-technology, reload, and agent-context workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# View instances

## Why this exists

Two windows can hold two questions about one Page. They should not create two Pages in
order to do it.

## Example workflow

An editor opens one Database in a Table tab and a Timeline pane, changes a record in the
Table, and sees the Timeline reconcile while its range and focus remain independent.

## Product contract

- A View instance references a canonical object plus instance-local presentation, focus, and selection state.
- Tabs, panes, embeds, and later windows may show the same object without duplicating it.
- Canonical mutations, permissions, and deletion reconcile across instances through shared Actions and state sync.
- Lazy rendering bounds resource use without falsely treating an unmounted instance as closed or complete.

## Boundaries and non-goals

Working set owns instance persistence. A View instance is not a Page, Database, Query,
permission boundary, or a fork of data.

## Acceptance stories

### Compare two presentations

Given a Database open in a Table and Timeline instance, when a person changes Timeline
range, then Table configuration is unchanged while both retain the same canonical records.

### Reconcile one edit

Given two authorized instances of one record, when an editor changes it through one, then
the other reflects the canonical result without duplicate history or stale copy.

## Current evidence

Existing tabs or embeds are donor substrate only; no complete multi-instance contract is
proven. This Capability remains `approved_shape`.

## Proof plan

1. Test two-instance focus, presentation, selection, close, persistence, and lazy rendering.
2. Verify mutations, permission changes, deletion, errors, and recovery across instances.
3. Exercise keyboard, assistive technology, reload, embed, and agent-context workflows.

## Open questions

Cross-window synchronization and focus-transfer policy need separate implementation design.

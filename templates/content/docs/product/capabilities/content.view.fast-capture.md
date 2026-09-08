---
record_type: "capability"
spec_version: 2
id: "content.view.fast-capture"
name: "Fast keyboard capture"
user_promise: "Keyboard-fluent List and Table capture"
primary_user_job: "Capture and revise a record at keyboard speed without leaving the current authorized View."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query", "content.agent.action-parity"]
related_features:
  [
    "content.feature.see-your-information-your-way",
    "content.feature.run-projects-your-way",
  ]
roadmap_boundary: "feature"
acceptance_summary: "List and Table capture create and edit canonical records through the shared Action surface, preserve keyboard focus, and roll back an unsuccessful optimistic update visibly."
proof_requirements:
  [
    "Keyboard-only create, edit, Enter, Tab, escape, navigation, and focus-return coverage",
    "Shared Action authorization, validation, history, error, and optimistic rollback coverage",
    "Real-interface assistive-technology and concurrent-refresh workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Fast keyboard capture

## Why this exists

Quick capture keeps a small thought from becoming a ceremony while retaining the
Database's rules and the record's canonical identity.

## Example workflow

An editor tabs to the last row of a filtered List, presses Enter, types a title,
and moves through editable cells with Tab. A rejected change returns focus and
an explanation; it does not leave a convincing but unsaved row behind.

## Product contract

- List and Table are keyboard editors of canonical Database records, not local drafts.
- Enter, Tab, arrow navigation, escape, selection, and focus restoration are predictable and accessible.
- Creation and edits use the same authorized Action, validation, Events, history, and failure behavior as an agent.
- Optimistic UI is reversible; denied, invalid, stale, or unavailable work is visibly distinct from success.

## Boundaries and non-goals

View-derived creation defaults own contextual seeds. This Capability does not define
bulk editing, a new inline data store, or a permission bypass.

## Acceptance stories

### Capture a record without a mouse

Given an editable List, when a person enters a title and tabs through a writable field,
then one valid canonical record is created and focus advances predictably.

### Recover from a rejected edit

Given an optimistic inline edit that fails validation, when the Action rejects it, then
the rendered value rolls back, focus remains useful, and the failure is announced.

## Current evidence

Existing Database editing and View machinery are donor substrate. No complete proof yet
covers keyboard semantics, Action parity, rollback, accessibility, and recovery; this
Capability remains `approved_shape`.

## Proof plan

1. Test keyboard creation and editing across List and Table with validation and permissions.
2. Verify Action/UI parity, Events, history, stale writes, rollback, and reload.
3. Exercise screen-reader announcements, focus order, and concurrent result refreshes.

## Open questions

The compact editor's exact escape and multi-cell paste semantics need interaction design.

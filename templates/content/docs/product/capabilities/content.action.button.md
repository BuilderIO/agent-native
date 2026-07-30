---
record_type: "capability"
spec_version: 2
id: "content.action.button"
name: "Action Buttons"
user_promise: "An owner-governed Button invokes an ordinary action or Rule with typed inputs and visible authority"
primary_user_job: "Let people trigger a governed operation from the object where its result matters."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.command.fabric", "content.rule.deterministic"]
related_features: ["content.feature.when-this-happens-that-follows"]
roadmap_boundary: "feature"
acceptance_summary: "Buttons are owner-governed command bindings with stable IDs, typed inputs, can-run reasons, confirmation, permission checks, receipts, and Undo where supported."
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

# Action Buttons

## Why this exists

A repeated local decision should be visible where people encounter its consequence, with authority and confirmation clear before anyone acts.

## Example workflow

A workspace owner adds an Approve button to a request Page. An editor sees its effect and required confirmation, invokes it, and receives an Event receipt with Undo when the action supports it.

## Product contract

Buttons are owner-governed command bindings with stable IDs, typed inputs, can-run reasons, confirmation, permission checks, receipts, and Undo where supported. They invoke the ordinary command or Rule Action; a Button never owns a private mutation path.

## Boundaries and non-goals

Button configuration and target Actions own behavior. This is not a macro language, hidden automation engine, or permission bypass.

## Acceptance stories

### Deny a button that cannot run

Given an editor without the target Action permission, when they view a Button, then it explains why it cannot run and cannot invoke the operation.

### Receipt and undo after approval

Given a confirmed reversible Button action, when it succeeds, then Content records one ordinary Event and exposes its supported Undo route.

## Current evidence

Template and Action substrate exist, but no complete button insertion, authority, confirmation, receipt, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Insert template Buttons and test stable bindings, arguments, and unavailable targets.
2. Exercise viewer, editor, owner, confirmation, cancellation, denial, receipts, Undo, and reload.
3. Use keyboard and screen readers to discover a Button, read its effect, and recover from failure.

## Open questions

The exact first Button placement and confirmation copy need interaction design.

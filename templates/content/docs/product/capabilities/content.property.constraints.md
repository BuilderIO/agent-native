---
record_type: "capability"
spec_version: 2
id: "content.property.constraints"
name: "Property validation and defaults"
user_promise: "Configure requiredness, defaults, validation, formatting, and edit policy once and trust every write path to enforce them."
primary_user_job: "Set constraints and defaults every mutation path enforces."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed", "content.expression.language"]
related_features:
  [
    "content.feature.data-that-keeps-itself-right",
    "content.feature.collect-structured-input",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Property configuration validates every mutation atomically; formulas remain live, while defaults evaluate once during a successful creation transaction and become stored values."
proof_requirements:
  [
    "Constraints, format, requiredness, and edit policy are typed configuration interpreted by the shared mutation boundary.",
    "Defaults evaluate exactly once only after the creation transaction has enough context to succeed; they are not live formulas.",
    "Validation failure returns typed field diagnostics and commits no partial mutation through UI, agent, import, source sync, or API.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Property validation and defaults

## Why this exists

A rule that only the form enforces is not a data rule. Authors need defaults and validation to behave predictably whether a record comes from a person, agent, import, or source synchronization.

## Example workflow

Elena creates a Form row with required Priority and a Due date default; the default stores once while a formula remains live.

## Product contract

- Constraints, format, requiredness, and edit policy are typed configuration interpreted by the shared mutation boundary.
- Defaults evaluate exactly once only after the creation transaction has enough context to succeed; they are not live formulas.
- Validation failure returns typed field diagnostics and commits no partial mutation through UI, agent, import, source sync, or API.

## Boundaries and non-goals

- Typed Properties own field type and Expressions own live computation; this record owns transaction-time defaults, constraints, format, and edit policy.
- Defaults are not formulas, and client-side form checks are not a substitute for the shared mutation boundary.

## Acceptance stories

### Roll back atomically

Given an agent changes two fields and one is invalid, when the mutation commits, then neither commits and the failing field is identified.

### Do not turn defaults live

Given a current-actor default, when the actor later changes, then later actor changes do not rewrite the stored value.

## Current evidence

`actions/configure-document-property.ts`, `set-document-property.ts`, and lifecycle tests are donors; cross-origin rule semantics are unproved.

## Proof plan

1. Configure/test via forms, UI, actions, import, and sync.
2. Verify defaults evaluate once and formulas remain live.
3. Test invalid multi-field rollback and typed errors.
4. Exercise denied dependencies and retry.

## Open questions

Default dependency ordering needs shaping.

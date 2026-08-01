---
record_type: "capability"
spec_version: 2
id: "content.source.row-union"
name: "Materialized multi-source Databases"
user_promise: "The former multi-source row-union model remains migration evidence, while active composition moves toward source Queries."
primary_user_job: "Understand the proven source-scoped row behavior without mistaking it for the active composition contract."
kind: "primitive"
state: "superseded"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters", "content.object.database"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "This lineage record preserves donor evidence for source-scoped rows, per-source field bindings, source selection, and guarded writes while directing new multi-source composition to saved source Queries and their access-safe semantics."
proof_requirements:
  [
    "Catalog validation of the supersession target",
    "Regression tests retaining source-scoped identity and guarded writes while legacy behavior remains",
    "Design review that routes new multi-source composition to content.view.source-query",
  ]
evidence: []
superseded_by: "content.view.source-query"
last_reviewed: "2026-07-29"
---

# Materialized multi-source Databases

## Why this exists

The row-union experiment taught useful boundaries, but its configuration surface is not the chosen future composition model.

## Example workflow

A maintainer fixing a legacy multi-source row preserves its source-scoped identity and write route, while a new combined view is designed as a saved source Query.

## Product contract

- This record is donor and migration lineage, not new feature direction.
- Legacy rows preserve source-scoped identity, selected source for new rows, visible Source provenance, per-source field bindings, and guarded source writes.
- New composition evaluates through `content.view.source-query`, where access and ownership are explicit rather than materialized into a confusing universal row surface.

## Boundaries and non-goals

This does not revive multi-source Database configuration, prove Query behavior, or authorize a bulk migration without its own recovery plan.

## Acceptance stories

### Preserve a legacy row route

Given a legacy row from a writable Source, when it is edited through its mapped binding, then only that Source receives the guarded change and the row retains source identity.

### Design new composition as a Query

Given a request to combine two Sources, when a new experience is planned, then it uses the saved source Query contract instead of adding another row-union configuration path.

## Current evidence

Donor evidence: `actions/_content-database-source-adapters.ts`, `actions/content-database-source-actions.test.ts`, and Builder source tests cover source-backed row behavior. This record is superseded and makes no active whole-contract claim.

## Proof plan

1. Keep source-scoped legacy tests while the model remains supported.
2. Validate the supersession link and review new composition work for Query ownership.
3. Plan any migration with identity, access, conflict, and rollback evidence.

## Open questions

- Legacy removal timing is intentionally not decided here.

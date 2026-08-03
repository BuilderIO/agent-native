---
record_type: "capability"
spec_version: 2
id: "content.access.row-private"
name: "Row-level privacy"
user_promise: "A Page or Database row can be shared more narrowly than its collection's ordinary visibility."
primary_user_job: "Keep a sensitive item in an otherwise shared workflow without copying it into a secret parallel system."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database"]
related_features: ["content.feature.explore-alternatives-safely"]
roadmap_boundary: "feature"
acceptance_summary: "Default Database visibility can be narrowed by row/Page principals, and every read, query, source operation, and mutation applies the resulting access before returning data."
proof_requirements:
  [
    "Default inheritance and explicit row/Page principal behavior",
    "Access-first query, view, search, aggregate, and export behavior",
    "Shared Action and UI mutation enforcement",
    "Source synchronization, deletion, restore, and access-change tests",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Row-level privacy

## Why this exists

A shared tracker sometimes contains a draft, personnel matter, or private alternative. The item should remain in the governed workflow without becoming ambiently discoverable.

## Example workflow

A team keeps a hiring Database visible to managers. One candidate row is restricted to a smaller panel. The panel can work with the row; other managers see neither its fields nor its contribution to counts.

## Product contract

- A Database supplies ordinary default access; a Page/row may narrow that visibility through explicit principals.
- Narrower row access applies before list, View, Query, relation traversal, search, aggregate, export, agent context, and source operations.
- An authorized direct link opens the Page; an unauthorized known direct link returns an honest generic denial.
- Row privacy does not make a Page's identity dependent on a Database or grant access through another membership.
- All mutations use the shared Action decision and record attributable history.

## Boundaries and non-goals

- Row privacy narrows inherited access; it does not widen a Page beyond allowed policy.
- It does not define public publishing or named-Version access, which have their own boundaries.
- Hiding a View column is presentation, not row privacy.

## Acceptance stories

### Hide a restricted row from collection work

Given one private row in a shared Database, when an unauthorized member opens a View, searches, groups, or exports it, then the row and its values do not appear or affect derived output.

### Keep direct access honest

Given an unauthorized person knows the private row's URL, when they open it or invoke an Action, then access is denied without reporting a successful empty Page or exposing its title.

## Current evidence

The repository has ownable records and access-aware Content surfaces, providing substrate. It does not yet prove complete per-row principals across every derived path and source policy, so the capability remains `approved_shape`.

## Proof plan

1. Exercise inheritance, restriction, principal changes, and recovery through UI and Actions.
2. Re-run Views, Queries, search, relationships, exports, agents, and aggregates for each role.
3. Test source sync/write-back and access changes during pending work.
4. Verify trash, restore, audit/history, and generic denial behavior.

## Open questions

Exact principal-management controls remain a surface design choice; no implementation may turn unavailable data into a successful empty result.

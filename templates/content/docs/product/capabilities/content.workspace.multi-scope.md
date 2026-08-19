---
record_type: "capability"
spec_version: 2
id: "content.workspace.multi-scope"
name: "Personal and organization contexts"
user_promise: "One identity can hold personal Content plus several workspaces without account switching"
primary_user_job: "Work in Personal and organization contexts under one identity without confusing their ownership, authority, or source of truth."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database"]
related_features:
  [
    "content.feature.find-your-place-again",
    "content.feature.work-across-every-workspace",
  ]
roadmap_boundary: "feature"
acceptance_summary: "One identity supports distinct Personal and organization contexts with visible current scope, explicit cross-context retrieval, organization opt-out, provenance, and audit."
proof_requirements:
  [
    "Distinct context identity, current-scope switching, and ownership persistence coverage",
    "Explicit cross-context retrieval, opt-out, access, provenance, and audit coverage",
    "Revoked membership, unavailable context, agent context, reload, and recovery workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Personal and organization contexts

## Why this exists

One person may carry private work and belong to many organizations. Convenience must not
turn those distinct contexts into one leaking room.

## Example workflow

A person switches from Personal to an organization, then asks for an explicitly global
search. Results carry their origin; an organization policy can exclude its work entirely.

## Product contract

- Personal and organization contexts remain distinct ownership and access domains under one identity.
- Current context is visible; cross-context retrieval is explicit, access-scoped, policy-governed, and auditable.
- Every returned object retains origin and opens under its owning context's authority.
- Membership loss, deletion, stale state, and unavailable contexts are not restored as usable state.

## Boundaries and non-goals

This primitive informs Home and working sets. It does not create an organization, merge
contexts, duplicate records, or make cross-context write implicit.

## Acceptance stories

### Switch without merging

Given Personal and organization work, when a person changes current context, then only
that scope is shown until they deliberately choose an allowed global retrieval.

### Revoke a membership

Given a previously visible organization item, when membership is revoked, then it no
longer appears in navigation, Home, agent context, or session restoration.

## Current evidence

The architecture establishes the required distinction; no complete multi-scope interface,
policy, provenance, and recovery proof is recorded. This remains `approved_shape`.

## Proof plan

1. Test scope switching, ownership, origin badges, global opt-in, and audit events.
2. Verify organization opt-out and access changes across UI, Actions, search, and agents.
3. Exercise revoked membership, unavailable context, reload, and recovery workflows.

## Open questions

The user-facing scope selector and default global-search posture need design.

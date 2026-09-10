---
record_type: "capability"
spec_version: 2
id: "content.home.global"
name: "Global Home"
user_promise: "Home belongs to the person and composes authorized work across Personal and organization contexts without pretending it all shares one Workspace."
primary_user_job: "See my authorized work across contexts while retaining clear provenance and the ability to stay within one context."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.multi-scope", "content.query.object"]
related_features:
  [
    "content.feature.find-your-place-again",
    "content.feature.work-across-every-workspace",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Person-owned Home composes explicitly scoped, authorized Personal and organization results with visible origin and opt-in cross-context retrieval."
proof_requirements:
  [
    "Personal, current-context, and explicit global scope selection and provenance coverage",
    "Access, organization opt-out, result isolation, agent-context, and audit coverage",
    "Real-interface empty, unavailable, revoked-access, reload, keyboard, and recovery workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Global Home

## Why this exists

A person's work often crosses contexts, but a useful overview must not flatten Personal
and organization ownership into one imaginary Workspace.

## Example workflow

A person opens Home, selects an explicitly global task section, sees origin badges, and
opens one result in its owning context. An organization that opts out contributes nothing.

## Product contract

- Home is owned by the person; it composes authorized results rather than owning their objects.
- Current-context and global retrieval are visible modes, with origin/provenance for every result.
- Cross-context retrieval is opt-in and honors organization policy, access, and audit boundaries.
- Revoked, deleted, unavailable, and stale items disappear or report their state without residue.

## Boundaries and non-goals

Multi-scope owns context and access semantics. Home is not a super-workspace, shared
organization dashboard, or cross-context mutation shortcut.

## Acceptance stories

### Keep origins visible

Given authorized work in Personal and two organizations, when a person opens global Home,
then each result identifies its origin and opens with that context's authority.

### Honor an opt-out

Given an organization that disallows global retrieval, when Home refreshes, then no row,
count, search suggestion, or agent context exposes its work.

## Current evidence

No complete person-owned cross-context Home proof is recorded. This Capability remains
`approved_shape`.

## Proof plan

1. Test current/global mode, provenance, opt-in policy, access changes, and audit records.
2. Verify result isolation through cards, counts, search, agents, and direct navigation.
3. Exercise empty, unavailable, revoked, reload, keyboard, and recovery workflows.

## Open questions

The initial Home modules and per-context opt-in controls need implementation design.

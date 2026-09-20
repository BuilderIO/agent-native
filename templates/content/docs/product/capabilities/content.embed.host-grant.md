---
record_type: "capability"
spec_version: 2
id: "content.embed.host-grant"
name: "Embedded host grants"
user_promise: "An embedded host gets only the mount and Actions it was granted, never more authority than the viewer."
primary_user_job: "Use Content inside another application without silently giving that application broad access to my work."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.embed.surface", "content.access.visibility-closure"]
related_features: ["content.feature.work-on-content-inside-another-application"]
roadmap_boundary: "feature"
acceptance_summary: "A named host grant scopes mount identity, permitted Actions, audience, expiry and revocation; every call is additionally constrained by the signed-in viewer's current Content authority."
proof_requirements:
  [
    "Grant issuance, scope, expiry, revocation, origin, and audience validation tests",
    "Cross-host authorization tests proving host grants cannot widen viewer access",
    "Embedded mutation and denied-action interface workflow with audit receipts",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Embedded host grants

## Why this exists

An embed is a borrowed room, not a spare key to the building.

## Example workflow

A planner mounts one project brief in a sibling app. The host may render and edit that brief through its grant; a request for another Page is denied even if the host knows its ID.

## Product contract

- A grant names host, mount, permitted Action capability, audience, lifetime, and revocation state.
- Every host request validates its grant and then resolves the current viewer's Content access; a host can only narrow, never widen, that authority.
- The shared Actions retain validation, Events, history, and honest outcomes. Hosts receive no database credentials or bypass route.
- Grant changes take effect for subsequent calls and do not retroactively publish cached material.

## Boundaries and non-goals

Embed surface owns rendering and lifecycle; sharing owns ordinary resource access. This does not make all hosts trusted or grant a host blanket workspace access.

## Acceptance stories

### Limit a mounted brief

Given a host grant for one Page and read permission, when the host requests a different Page, then Content denies it even if the viewer could open that Page directly.

### Revoke a host capability

Given a host has edit permission, when the owner revokes the grant, then its next mutation is denied and no new Event is committed.

## Current evidence

Donor evidence: shared toolkit components and Content access primitives can support reuse. No repository proof yet covers signed grants, origin validation, revocation, or host/viewer intersection; this record remains `approved_shape`.

## Proof plan

1. Define signed or server-resolved grants with narrow capability claims.
2. Test expiry, revocation, origin, mount substitution, and authority intersection.
3. Verify an embedded edit and denial path with receipts and accessible status.

## Open questions

- The host identity handshake remains open provided it cannot widen viewer authority.

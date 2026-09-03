---
record_type: "capability"
spec_version: 2
id: "content.api.cms"
name: "Content API and CMS"
user_promise: "External clients and websites can use Content without a second, weaker product contract."
primary_user_job: "Read or change an authorized Content object from another client and receive the same truthful result as the Content interface."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.action-parity", "content.access.page-database"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "A documented typed client surface invokes the same Actions as people and agents, preserves actor and origin, enforces current access and validation, and returns distinguishable success, denial, conflict, and failure outcomes."
proof_requirements:
  [
    "Contract tests proving client calls route through named typed Actions rather than parallel CRUD",
    "Authorization, validation, audit, idempotency, and error-state parity tests across interface, agent, and external client",
    "End-to-end client workflow covering read, mutation, denied access, conflict, and receipt",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Content API and CMS

## Why this exists

CMS consumers need Content truth without a shadow datastore or a special permission lane.

## Example workflow

A site editor loads an authorized Page through a typed client, changes its title through an Action, and receives the same validation error or committed receipt they would see in Content.

## Product contract

- The API is a client of the shared typed Action surface; it does not expose route-shaped CRUD as a rival contract.
- Each request resolves the acting identity and current access before reading, traversing, or mutating Content.
- Mutations retain actor, origin, idempotency, validation, Events, history, and receipts. Unsupported, denied, conflict, and failed outcomes remain distinct.
- Public reading is governed by publication and visibility contracts, not by an API key that bypasses them.

## Boundaries and non-goals

This is not a generic database proxy, a provider API replacement, or a promise that every internal Action is public. Publication owns public URLs; embeds own host grants.

## Acceptance stories

### Use the same mutation boundary

Given an authorized external client, when it changes a Page through the typed Action, then Content applies the ordinary validation and records the client origin in the committed receipt.

### Refuse a hidden record

Given a client token without access to a Page, when it requests that Page or a Query containing it, then the result reveals neither the record nor its derived data.

## Current evidence

Donor evidence: `actions/` contains Content operations and shared Action use. No repository proof yet demonstrates a complete external typed client contract, parity matrix, or end-to-end CMS workflow; this record remains `approved_shape`.

## Proof plan

1. Define a public, versioned typed client boundary over selected Actions.
2. Test authorization, validation, audit, idempotency, and error parity.
3. Run a real client read/change/denial/conflict workflow and retain receipts.

## Open questions

- The initial authentication and client packaging boundary remains to be selected without creating a second authority model.

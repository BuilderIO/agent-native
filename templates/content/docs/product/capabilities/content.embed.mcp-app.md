---
record_type: "capability"
spec_version: 2
id: "content.embed.mcp-app"
name: "MCP App embedding"
user_promise: "Compatible agent hosts can show a focused Content surface without receiving a copied object or broader authority."
primary_user_job: "Open the same governed Content object from a compatible agent host and understand what the host may do."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "external_host"
dependencies: ["content.embed.surface", "content.embed.host-grant"]
related_features: ["content.feature.work-on-content-inside-another-application"]
roadmap_boundary: "feature"
acceptance_summary: "An MCP App integration adapts the canonical embed mount and host-grant contract to compatible hosts, preserves viewer-scoped actions and receipts, and fails clearly when host capabilities are absent."
proof_requirements:
  [
    "Protocol compatibility and host capability-negotiation tests",
    "Grant and viewer-authority parity tests against the ordinary embedded surface",
    "Compatible-host mount, mutation, unavailable-host, and revocation workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# MCP App embedding

## Why this exists

MCP App support should widen where Content can appear, not what an outside host may possess.

## Example workflow

An agent host opens a granted Page as an MCP App. It renders the canonical mount, calls only granted Actions, and reports an unavailable capability when the host cannot provide the required presentation feature.

## Product contract

- This surface adapts `content.embed.surface` and `content.embed.host-grant`; it does not invent a parallel object, auth, or mutation path.
- Host capability negotiation names what the host can render or invoke. Missing capability is unavailable, not a successful empty mount.
- Viewer access, grant scope, validation, Events, history, and receipts remain Content-owned.

## Boundaries and non-goals

This does not make every MCP client a supported editor, expose all Actions as tools, or replace native sibling-app embedding.

## Acceptance stories

### Mount the canonical object

Given a compatible host and a grant for one Page, when it opens the MCP App, then it sees the canonical Page state rather than a copied snapshot.

### Tell the truth about host limits

Given a host that lacks a required interaction capability, when it requests that mount mode, then Content reports it unavailable and does not silently substitute broader access.

## Current evidence

Donor evidence: `changelog/2026-07-28-builder-content-reads-now-negotiate-the-newest-mcp-protocol-.md` records protocol-related substrate. No complete Content MCP App mount and grant proof exists; this record remains `approved_shape`.

## Proof plan

1. Implement narrow protocol negotiation over the canonical embed contract.
2. Test compatible, incompatible, revoked, and viewer-denied cases.
3. Verify a real host mount and mutation receipt without a copied authority path.

## Open questions

- The first compatible host and supported interaction subset remain open.

---
record_type: "capability"
spec_version: 2
id: "content.agent.action-parity"
name: "Agent and UI parity"
user_promise: "Humans and agents use the same operations and visible state"
primary_user_job: "Use an agent to do ordinary Content work with the same authority, validation, and truthful result a person would receive."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: []
related_features:
  [
    "content.feature.durable-foundations",
    "content.feature.when-this-happens-that-follows",
    "content.feature.collect-structured-input",
    "content.feature.work-on-content-inside-another-application",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Every operation exposes one typed Action contract for UI, agent, automation, and API callers."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence:
  - "../../../actions/database-setup-mcp.db.test.ts"
  - "../../../actions/database-setup.db.test.ts"
  - "../../../actions/database-property-view-setup.db.test.ts"
  - "../../../app/hooks/use-document-properties.test.ts"
  - "../../../app/hooks/use-content-database-view-mutation.test.ts"
superseded_by: null
last_reviewed: "2026-09-09"
---

# Agent and UI parity

## Why this exists

An assistant that succeeds where the editor would fail erodes trust in both surfaces. Content needs one accountable path from request to committed change.

## Example workflow

A person asks an agent to update a Database record. The agent calls the same Action as the editor, receives the same validation failure if it is invalid, and returns the canonical result.

## Product contract

Every operation exposes one typed Action contract for UI, agent, automation, and API callers. Authorization, validation, Events, history, recovery, current context, and error states are shared; caller-specific presentation cannot invent a privileged task engine.

## Boundaries and non-goals

Individual capability records own their concrete workflows. Parity does not mean identical interface affordances or unrestricted agent context.

## Acceptance stories

### Reject an agent-only privilege

Given a viewer denied an edit in the UI, when an agent attempts the same edit, then the same Action denies it without leaking unavailable fields.

### Observe one change from both surfaces

Given an Action succeeds through an agent, when the Page is opened, then it shows one canonical mutation and ordinary history rather than an agent-only copy.

## Current evidence

Ordinary database setup has a bounded shared contract: create an empty database, configure supported ordinary properties, save table views, edit rows, and move a database to Trash or restore it. MCP callers use explicit target identities, revision checks, and idempotency keys. Setup receipts include canonical read-back and links; UI property and view edits use the same guarded actions. Source reads expose scoped metadata, while source writes and computed-property configuration remain outside this contract.

SDK integration tests exercise discovery, the setup lifecycle, concurrent retries, stale revisions, permission changes, source redaction, and rejection of legacy MCP payloads. Database tests cover PGlite and PostgreSQL; UI adapter tests cover canonical receipt updates and queued edits. These checks establish this bounded implementation, not deployed acceptance or complete parity across Content. Per-capability real-interface proof and broader parity evaluations remain incomplete. This Capability remains `in_progress`.

## Proof plan

1. Compare Page, Database, and collaboration Action inputs, results, and failures.
2. Test permission changes, field visibility, history, conflict, and unavailable sources in both callers.
3. Run paired human and agent workflows with accessible UI evidence.

## Open questions

The first cross-surface parity fixture catalog needs implementation design.

---
record_type: "capability"
spec_version: 2
id: "content.property.actor"
name: "Actor properties"
user_promise: "Know who actually created or last changed a record, whether that actor was a person, agent, automation, or integration."
primary_user_job: "Understand actual creators and editors across actor kinds."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed"]
related_features:
  [
    "content.feature.durable-foundations",
    "content.feature.data-that-keeps-itself-right",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Created by and Last edited by are typed actor properties derived from committed mutations and retain actual actor and origin rather than a misleading shared account."
proof_requirements:
  [
    "Actor values identify the actual human, agent, automation, or integration that committed the change.",
    "Creation sets Created by once; later committed changes update Last edited by without overwriting provenance.",
    "Denied, imported, or unavailable actor identity is represented honestly and does not collapse into a false personal attribution.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Actor properties

## Why this exists

Collaboration loses accountability when automation and agents are flattened into a generic service identity. People need to distinguish who first created a record from who most recently changed it and how that change arrived.

## Example workflow

A coordinator creates a request, automation enriches it, and an agent edits status; Created by stays coordinator while Last edited by names the agent.

## Product contract

- Actor values identify the actual human, agent, automation, or integration that committed the change.
- Creation sets Created by once; later committed changes update Last edited by without overwriting provenance.
- Denied, imported, or unavailable actor identity is represented honestly and does not collapse into a false personal attribution.

## Boundaries and non-goals

- Committed events own mutation attribution and origin; Actor Properties project that record into stable created/last-edited fields.
- Actor fields are not a permissions mechanism and do not fabricate a current-person identity when provenance is unresolved.

## Acceptance stories

### Keep creation provenance

Given imported work is later edited, when a person commits the change, then Created by remains imported origin.

### Admit unknown identity

Given legacy resolution fails, when the actor Property renders, then the actor field says unresolved rather than current viewer.

## Current evidence

`actions/create-document.ts`, `update-document.ts`, and `edit-document.ts` are donors; `server/db/schema.ts` timestamps do not prove actor fields.

## Proof plan

1. Exercise person/agent/automation/integration/import/restore.
2. Render access-aware actor and unresolved states.
3. Export/import without identity leakage.
4. Compare receipts and displayed actor.

## Open questions

Actor card versus text renderer remains open.

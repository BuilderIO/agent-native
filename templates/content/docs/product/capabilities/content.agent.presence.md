---
record_type: "capability"
spec_version: 2
id: "content.agent.presence"
name: "Agent presence"
user_promise: "One accountable agent presence gives authorized collaborators an ephemeral view of a run's current locations without replacing durable attribution, review, or the real mutation."
primary_user_job: "See where an active agent run is working right now, including concurrent locations, without exposing private work or mistaking a live indicator for history or approval."
kind: "surface"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.action-parity", "content.event.committed"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "Authorized collaborators can see one ephemeral presence for an accountable active run and its currently authorized locations; presence may degrade or fail without delaying an authorized mutation, while Events/History retain durable attribution and review state."
proof_requirements:
  [
    "A run-scoped presence model that represents one run across multiple current locations and removes inaccessible locations per viewer",
    "Lifecycle proof for starting, progressing, stopping, canceling, failure, completion, linger/expiry, and concurrent locations",
    "Best-effort transport/storage behavior proving presence failure neither blocks nor reclassifies an authorized mutation",
    "Real-interface and access tests that distinguish live presence from Events, History, review, and reversible change",
  ]
evidence:
  [
    "packages/core/src/collab/agent-presence.ts",
    "packages/core/src/collab/agent-presence.spec.ts",
    "packages/core/src/collab/awareness-store.ts",
    "packages/core/src/collab/ydoc-manager.ts",
    "packages/toolkit/src/collab-ui/AgentPresenceChip.tsx",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent presence

## Why this exists

Live collaboration benefits from a small, current-state answer to “where is the agent working?” That answer is not the same as attribution, history, a review decision, or an audit record. Treating a transient cursor as any of those would make important work disappear with the network.

Agent presence therefore visualizes the present moment over an accountable run. Events, Revisions, Versions, receipts, and History remain the durable record of who changed what and what was reviewed.

## Example workflow

An agent run updates two authorized Pages and a structured record. Collaborators who can access each location see one running agent with the applicable current locations and short-lived recent-edit cues. A collaborator without access to one Page sees only the locations they may access. If the presence channel drops, the authorized mutations still commit through the normal action path and later appear in History. Stopping a run prevents further work; canceling ends pending work; reverting is a later, separate authorized change to committed results.

## Product contract

### Ephemeral, run-scoped current state

- One accountable run has one presence identity and may report multiple simultaneous current locations. A location is a current working target, not a durable claim that every prior change belongs to the viewer's visible activity feed.
- Presence is ephemeral and may linger briefly to make a just-completed change legible, then expires. Completion, failure, loss of transport, or process restart never erase the durable Events/History produced by real actions.
- A viewer sees only locations and descriptors they are currently authorized to access. Hidden, revoked, or inaccessible locations are omitted without names, counts, ordering gaps, or other existence leaks.
- Presence describes activity, not review state. It does not mark a change accepted, rejected, verified, reverted, or recoverable; those meanings belong to durable Events, Revisions, Versions, and their owning surfaces.

### Lifecycle and mutation independence

- Starting, progressing, completing, failing, stopping, and canceling a run have distinct current-state semantics. **Stop** requests no further work; **cancel** ends pending work according to the run contract; **revert** is a separate, authorized mutation over already committed work and does not mean that presence was stopped.
- Presence publication, cross-instance mirroring, polling, and expiry are best effort. Their failure must not block, delay, roll back, or falsely report failure for an otherwise authorized real mutation.
- An action may update presence before, during, or after its mutation, but its durable Event/Revision and result must not depend on presence transport success. A failed mutation must not leave a convincing active or completed presence state; the run reports its actual terminal condition when known.
- A run that loses access to a location removes it from future presence projection and cannot use that loss as permission to continue work there.

## Boundaries and non-goals

- Presence is not a generic agent activity panel, run history, audit log, review queue, approval mechanism, or substitute for Events/Versions/History.
- It does not expose per-character imitation as the primary collaboration model, and it does not make lingering visual cues durable attribution.
- It does not broaden access, reveal inaccessible locations, guarantee delivery, or change a mutation's authorization/recoverability semantics.
- It does not define stop, cancellation, rollback, or recovery mechanics beyond presenting their current run state accurately.

## Acceptance stories

### Show one run in several authorized locations

Given one active agent run is modifying two Pages and a record that a collaborator can access, when the collaborator opens the relevant surfaces, then they see one run-scoped presence with its authorized current locations rather than separate unaccountable agents or a fabricated single location.

### Hide private concurrent work

Given the same run also works in a Page the collaborator cannot access, when presence updates arrive, then the collaborator sees no title, count, timing clue, placeholder, or recent-edit descriptor for that Page while authorized viewers can see their permitted projection.

### Keep mutation truth durable when presence fails

Given an authorized agent mutation succeeds while the presence mirror or poll transport fails, when the action completes, then the mutation result and durable Event/History remain available, the UI reports presence degradation truthfully if observable, and no mutation waits for presence to recover.

### Keep stopping, canceling, and reverting distinct

Given a run has committed one change and has later work pending, when a user stops it, cancels it, or separately reverts the committed change, then each operation has its own status and Event behavior; reverting does not claim the run was canceled, and canceling does not silently undo committed work.

## Current evidence

There is meaningful but narrower substrate. `packages/core/src/collab/agent-presence.ts` maintains per-document agent awareness, heartbeat, reference-counted enter/leave, lingering removal, and recent-edit metadata; `packages/core/src/collab/agent-presence.spec.ts` exercises those lifecycle details. `packages/core/src/collab/ydoc-manager.ts` automatically touches agent presence for agent-sourced collaborative writes. `packages/core/src/collab/awareness-store.ts` mirrors awareness best-effort and explicitly prevents presence failures from failing an edit. `packages/toolkit/src/collab-ui/AgentPresenceChip.tsx` provides a small reusable display component.

This substrate is document-scoped, uses one agent client identity, and does not yet prove accountable run identity, multi-location aggregation, viewer-specific location filtering, terminal-state semantics, or a Content UI that distinguishes presence from durable attribution and review. The Capability therefore remains `in_progress`.

## Proof plan

1. Introduce deterministic run-scoped presence tests for one run across concurrent Pages/records, nested work, terminal states, linger/expiry, restart, and transport loss.
2. Exercise access changes and viewer-specific projections across every presence surface; prove inaccessible locations and descriptors cannot leak through labels, counts, timing, events, or caches.
3. Fault-inject awareness persistence, polling, and client rendering while running authorized mutations; prove action result, committed Event/Revision, and recovery semantics remain independent.
4. Complete real-interface flows for active work, multiple locations, stop, cancel, failure, completion, and revert; verify the UI routes inspection/review/history to their durable surfaces instead of presence.

## Open questions

The exact run/location data shape, UI placement, stale indicator language, and cross-device aggregation strategy remain open. They must preserve one accountable ephemeral presence, access-safe projection, distinct terminal operations, and durable attribution outside the presence channel.

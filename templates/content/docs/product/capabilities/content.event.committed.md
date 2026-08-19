---
record_type: "capability"
spec_version: 2
id: "content.event.committed"
name: "Committed Events"
user_promise: "Meaningful committed changes have one durable, actor-aware Event spine."
primary_user_job: "Understand what changed, by whom and why, without mistaking every keystroke or snapshot for intentional work."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: []
related_features:
  [
    "content.feature.durable-foundations",
    "content.feature.collaborate-in-context",
    "content.feature.review-changes-in-place",
    "content.feature.trust-your-connected-sources",
    "content.feature.evolve-systems-safely",
    "content.feature.when-this-happens-that-follows",
    "content.feature.collect-structured-input",
    "content.feature.move-without-starting-over",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Every meaningful committed mutation writes an atomic durable Event with actor, authority, origin, causality, target, and recoverable outcome in the same transaction or reliable outbox."
proof_requirements:
  [
    "Atomic outbox or equivalent commit coupling for mutation paths",
    "Actor, authority, origin, target, causality, and outcome attribution",
    "Human, agent, Rule, automation, API, and source mutation coverage",
    "Failure, retry, idempotency, access, and recovery evidence",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Committed Events

## Why this exists

People need a trustworthy account of meaningful work. A cursor twitch is not history, and an untraceable automated change is a ghost in the machinery.

## Example workflow

An agent updates several Blocks and a Property in one authorized run. Content commits atomic Events for the actual mutations, ties them to the authorizing context and causal run, and lets a reviewer later inspect the grouped Revision without claiming the run was a single database write.

## Product contract

- A committed Event records one meaningful atomic change after it commits, not every keystroke or cursor move.
- It retains actor, authority, origin, target, causal context, outcome, and recoverable change information appropriate to the operation.
- Human editing coalesces at logical commit boundaries; agents, Rules, source syncs, and automation carry explicit causality.
- Event emission couples to mutation through one transaction or reliable outbox so a committed change cannot quietly lose its Event.
- Events are atomic facts. Logical Revisions group related Events; snapshots protect recovery; named Versions are deliberate alternatives.

## Boundaries and non-goals

- Events do not make every persistence snapshot a reviewable Revision.
- They do not replace Discussion's curated collaboration timeline or History's queryable projection.
- The spine does not authorize an operation or expose inaccessible Event contents.

## Acceptance stories

### Attribute an agent run accurately

Given an authorized agent run changes two Blocks and one Property, when it commits, then each meaningful mutation has an Event with agent origin and causal run, and the signed-in person is retained as authority rather than substituted as the actor.

### Fail without a phantom success

Given a mutation cannot persist its Event/outbox record, when the commit fails, then the mutation is not reported as success and retry cannot create duplicate live meaning.

## Current evidence

Existing document actions, snapshots, source audit machinery, and action infrastructure are useful donors. The repository does not yet demonstrate one atomic actor-aware Event spine across mutation paths; this remains `in_progress`.

## Proof plan

1. Inventory and exercise Page, Database, comment, source, Rule, automation, and review mutations.
2. Simulate transaction/outbox interruption, retry, duplicate delivery, and partial failure.
3. Verify attribution, causal grouping inputs, access-scoped reads, recovery, and Undo.
4. Test real UI and shared agent/API Actions under concurrent commits.

## Open questions

Outbox transport and payload storage can vary. The atomic fact, attribution, and no-dropped-success contract cannot.

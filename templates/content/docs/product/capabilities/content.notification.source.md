---
record_type: "capability"
spec_version: 2
id: "content.notification.source"
name: "Notifications"
user_promise: "Canonical notifications exposed as queryable Content source and Views"
primary_user_job: "Receive and organize meaningful notices without confusing them with Tasks or losing their read state."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed"]
related_features:
  [
    "content.feature.collaborate-in-context",
    "content.feature.run-projects-your-way",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Notifications have stable identity, actor and origin, read and archive state, access-scoped routing Rules, and queryable Source/View representation."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Notifications

## Why this exists

A notification is a trace of something that happened to a person, not an assignment pretending to be urgent. Its read state belongs to that trace.

## Example workflow

A person receives a comment notification, opens its canonical target, marks the notice read, and archives it. A notification View updates without turning the item into My Tasks.

## Product contract

Notifications have stable identity, actor and origin, read and archive state, access-scoped routing Rules, and queryable Source/View representation. Their target remains canonical and My Tasks stays separate.

## Boundaries and non-goals

Committed Events own origins and routing owns delivery. This is not a task assignment engine, a duplicated inbox record, or a bypass around target access.

## Acceptance stories

### Read a comment notice without creating a task

Given a notification target becomes inaccessible, when the list refreshes, then the notice follows its policy without leaking the target title or preview.

### Remove a notice when target access is revoked

Given a person marks one notice read, when they reopen another View, then the same canonical notification state appears without altering task membership.

## Current evidence

No complete notification identity, routing, state, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test committed-event notices, target routes, read/archive state, and routing Rules.
2. Verify target access changes, queryable Views, duplicate delivery, and task separation.
3. Exercise revocation, archive retention, device conflicts, and accessible navigation.

## Open questions

The archive-retention and multi-device read-conflict policies need design.

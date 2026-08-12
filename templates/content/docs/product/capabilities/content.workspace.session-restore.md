---
record_type: "capability"
spec_version: 2
id: "content.workspace.session-restore"
name: "Session resumption"
user_promise: "Content reopens the authorized object and focused View a person was using without requiring them to reconstruct the route."
primary_user_job: "Resume interrupted work quickly without reopening stale, deleted, or newly unauthorized information."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.working-set"]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "Session restoration reopens the last authorized object and focused saved or personal View after a normal interruption, discarding stale or inaccessible UI state safely."
proof_requirements:
  [
    "Restart restoration of focus, View configuration, selection, and authorized route coverage",
    "Deleted, stale, changed-permission, unavailable, and cross-context invalidation coverage",
    "Real-interface reload, crash/restart, keyboard focus, agent-context, and recovery workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Session resumption

## Why this exists

Returning to work should feel like a held thread, not a scavenger hunt—and never like a
resurrection spell for information a person may no longer open.

## Example workflow

An editor leaves a focused Timeline View, restarts the application, and returns there.
If the Page was deleted or access changed, Content opens a safe fallback and explains it.

## Product contract

- Session state stores UI references and focus, never a substitute copy of object truth.
- Restoration reauthorizes every target before reopening it and drops invalid state safely.
- Saved or personal View focus restores when still authorized; ephemeral renderer state is bounded.
- Recovery distinguishes normal restoration, missing target, denied target, and unavailable source.
- At the root route, Content restores the last authorized Page. When no saved Page exists or the target is no longer available, it creates or reuses one private, editable Personal `Welcome to Agent-Native Content` Page.
- Explicit Page links take precedence over root-route restoration. A fallback does not reveal the unavailable Page's title, preview, or owning context.

## Boundaries and non-goals

Working set owns persisted UI state. Session restoration is not a guarantee to preserve
every inactive renderer, unsaved local draft, or unauthorized content.

## Acceptance stories

### Resume an authorized View

Given an editor focused on an authorized saved View, when the app restarts normally, then
Content reopens that object and View with a usable focus target.

### Discard revoked state

Given saved state for an object whose access is revoked, when the session restores, then
Content omits the object and does not reveal its title, preview, or prior selection.

### Give a new person an honest starting place

Given a person with no saved Content location but with organization-visible Pages, when they open the root route, then Content opens one private Personal welcome Page instead of selecting an arbitrary organization Page.

## Current evidence

Persisted navigation donors do not prove reauthorization, fallback, and recovery. This
Capability remains `approved_shape`.

## Proof plan

1. Test normal restart, focused Views, selections, and bounded renderer restoration.
2. Test deleted, stale, denied, unavailable, and cross-context state invalidation.
3. Exercise reload/crash recovery, keyboard focus, agents, and accessible explanations.

## Open questions

The first Page-level fallback order is settled. Full saved View, selection, and renderer-state restoration remains to be designed and proven.

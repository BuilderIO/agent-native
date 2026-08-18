---
record_type: "capability"
spec_version: 2
id: "content.workspace.working-set"
name: "Working set"
user_promise: "Tabs, split panes, and later windows are views over one persisted working set with explicit agent scope"
primary_user_job: "Keep the few things I am actively using together without turning temporary UI state into object truth or hidden agent context."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.multi-scope"]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "A persisted working set holds stable, authorized View references and local presentation state for tabs and panes, with explicit focus, bounded lazy rendering, and visible agent scope."
proof_requirements:
  [
    "Stable references, focus, selection, ordering, pane layout, and persistence coverage",
    "Scope, access revocation, source boundary, agent-context consent, close, and recovery coverage",
    "Lazy rendering, reload, keyboard, assistive-technology, and concurrent UI workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Working set

## Why this exists

Active work deserves continuity, but a tab strip must not become a secret database or an
unannounced briefing packet for an agent.

## Example workflow

A person keeps a project, a filtered task View, and a note in split panes, focuses the
task View, and chooses which focused context an agent may use. Reordering panes changes
only their working set.

## Product contract

- The working set persists stable authorized View references and UI state, not object copies or truth.
- Tabs, panes, and future windows share one explicit focus and selection model with bounded lazy rendering.
- Current context and explicit consent govern what an agent receives; background tabs are not implied context.
- Access loss, deletion, source unavailability, and scope changes invalidate or annotate state safely.

## Boundaries and non-goals

Multi-scope owns ownership boundaries and View instances own a rendering occurrence. This
is not shared document structure, an agent surveillance feed, or a second navigation tree.

## Acceptance stories

### Keep temporary arrangement personal

Given two people viewing the same project, when one rearranges tabs and panes, then the
other person's layout and the project's canonical structure remain unchanged.

### Make agent scope explicit

Given several open panes, when a person asks an agent about the focused task View, then
only the explicitly selected authorized context is supplied and its origin remains visible.

## Current evidence

No complete persisted working-set, consent, access-invalidating, and recovery proof is
recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test references, focus, panes, ordering, persistence, close, and lazy rendering.
2. Verify access and context changes, source boundaries, agent consent, and recovery.
3. Exercise reload, concurrent UI changes, keyboard, and assistive-technology workflows.

## Open questions

The first explicit agent-context selector and cross-device persistence policy need design.

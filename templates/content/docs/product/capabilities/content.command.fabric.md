---
record_type: "capability"
spec_version: 2
id: "content.command.fabric"
name: "Unified commands"
user_promise: "Slash, Cmd+K, menus, shortcuts, Buttons, and agents discover the same scoped commands and Actions"
primary_user_job: "Discover the right permitted operation from any surface and understand its effect before committing it."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.action-parity"]
related_features: ["content.feature.put-your-organizations-know-how-to-work"]
roadmap_boundary: "feature"
acceptance_summary: "Commands have stable IDs, typed arguments, scope, ranking, can-run reasons, effects, confirmation, permission, receipt, and Undo metadata."
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

# Unified commands

## Why this exists

The same verb should not change its authority or side effect when reached through a palette, shortcut, menu, Button, or agent.

## Example workflow

A person opens Cmd+K on a Page, finds Archive, sees that confirmation is needed, and runs the same command available from the page menu and agent chat.

## Product contract

Commands have stable IDs, typed arguments, scope, ranking, can-run reasons, effects, confirmation, permission, receipt, and Undo metadata. Every invocation resolves to the same shared Action.

## Boundaries and non-goals

Action parity owns operation semantics and Buttons bind commands. This is not a separate menu mutation API or a guarantee that every command appears in every surface.

## Acceptance stories

### Explain a disabled command

Given a command unavailable for the focused Page, when it is searched in Cmd+K, then Content explains the scope or permission reason and does not run it.

### Invoke Archive from two entry points

Given an agent and menu invoke the same command, when both are authorized, then they produce equivalent Action results and Events.

## Current evidence

No complete command discovery, ranking, confirmation, and cross-surface proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test command ID stability, arguments, ranking, and can-run explanations.
2. Compare menu, palette, shortcut, Button, slash, and agent invocation results.
3. Test confirmation, cancellation, denial, Undo, shortcut collisions, and reload.

## Open questions

The command ranking model and shortcut conflict policy need design.

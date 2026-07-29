---
record_type: "capability"
id: "content.command.fabric"
name: "Unified commands"
user_promise: "Slash, Cmd+K, menus, shortcuts, Buttons, and agents discover the same scoped commands/actions"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.action-parity"]
related_features: ["content.feature.put-your-organizations-know-how-to-work"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable command IDs, args, can-run reasons, side effects, confirmation, undo, permissions, ranking, tests."
proof_requirements: ["Stable command IDs, args, can-run reasons, side effects, confirmation, undo, permissions, ranking, tests."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Unified commands

## Contract

Slash, Cmd+K, menus, shortcuts, Buttons, and agents discover the same scoped commands/actions

## Acceptance boundary

A complete proof demonstrates: Stable command IDs, args, can-run reasons, side effects, confirmation, undo, permissions, ranking, tests.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.

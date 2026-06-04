---
name: visualize-plan
description: >-
  Convert an existing Codex, Claude Code, Markdown, or pasted plan into an
  Agent-Native Plans HTML companion with diagrams, wireframes, annotations, and
  feedback.
metadata:
  visibility: exported
---

# Visualize Plan

Use this when a text plan already exists and should become a richer HTML review
surface. Call `visualize-plan` with the source text, then enrich the result with
`update-visual-plan` if diagrams, wireframes, mockups, option cards, or explicit
questions would make the plan easier to review.

Wireframes should be concrete enough to critique: layout regions, controls,
states, empty/loading/error paths, review affordances, and copy placeholders.
When the source plan is terse, add README-like detail for slash commands, tool
behavior, install flow, MCP/link fallback, data shape, and scope.

## Plan Discipline

- **Right-size first.** If the source plan is for trivial, unambiguous work,
  skip the companion and just implement. A visual companion is worth it only
  when the plan is long, risky, or hard to react to as text.
- **Stay grounded and read-only.** Preserve the source plan's intent, do not
  invent codebase facts, and label anything inferred as inferred. Make no source
  edits while building or reviewing the companion.
- **The companion is the approval gate.** Ask the user to review and approve the
  direction before you write any code, and name which files/areas the work will
  touch. Carry unresolved assumptions and open questions into a clear block
  instead of guessing silently.

Ask the user to comment in the plan, then call `get-plan-feedback` before
implementation.

If the source is UI-heavy and the user wants a fresh plan instead of a companion,
use `/ui-plan` so an optional top pan/zoom wireframe canvas, rich document
blocks, comments/drawing affordances, and agent handoff come before file
implementation details.

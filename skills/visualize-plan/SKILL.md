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

Ask the user to comment in the plan, then call `get-plan-feedback` before
implementation.

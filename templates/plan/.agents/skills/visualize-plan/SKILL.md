---
name: visualize-plan
description: >-
  Convert an existing Codex, Claude Code, Markdown, or pasted plan into an
  Agent-Native Plans HTML companion with diagrams, wireframes, annotations, and
  feedback.
---

# Visualize Plan

Use this when a plan already exists and the user wants it to become easier to
review. The native Codex or Claude Code plan can stay where it is; Agent-Native
Plans creates an HTML companion with richer visual sections.

This is for people who need something to react to quickly: diagrams, UI mocks,
state sketches, option cards, and comment prompts instead of a wall of text. It
should still read like a plan, not a marketing page.

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

## Workflow

1. Gather the existing plan text from the user's paste, a referenced file, or
   recent visible agent context. Do not invent the source plan.
2. Call `visualize-plan` with `planText`, `title`, `brief`, `source`, and
   `repoPath` when available.
3. Surface the returned Agent-Native Plans link or inline MCP App.
4. Enrich the imported plan with `update-visual-plan` when helpful:
   - diagrams for architecture, data flow, state machines, or dependencies;
   - detailed wireframes/mockups for user-visible UI changes, including layout,
     controls, states, empty/loading/error paths, and copy placeholders;
   - two or three option cards when there are real tradeoffs;
   - small prototype sketches for interactions, states, or animation choices;
   - explicit open questions or assumptions that need reaction.
5. Ask the user to react in the visual plan. Then call `get-plan-feedback`
   before implementing, after review, and before final response.
6. Treat imported text as source material. The HTML plan and comments are the
   review surface.

If there is no existing plan text and the work is UI-heavy, use `/ui-plan`
instead so an optional top pan/zoom wireframe canvas, rich document blocks,
comments/drawing affordances, and agent handoff come before file implementation
details.

## Visual Defaults

- Keep the first screen simple and plan-like: title, brief, concise scope, and
  one useful diagram/checklist/table when it helps.
- Prefer one excellent diagram or wireframe over many noisy widgets.
- Preserve the plan's original structure, but make it more consumable.
- Preserve implementation-plan substance: phases or steps, files/symbols,
  snippets, risks, open questions, and validation.
- Add README-like detail when the source is too terse: slash commands, tool
  behavior, install flow, MCP/link fallback, data shape, and scope.
- Avoid decorative hero art, gradient/hero backgrounds, logos, nav bars,
  slogans, fluffy value props, huge landing-page H1s, and marketing-style cards
  unless the user explicitly asks.
- Visuals should be review aids, not decoration.
- Label inferred visuals as inferred when they go beyond the source text.
- Ask for feedback with targeted prompts: "Which option?", "Is this flow
  right?", "What should change?", "What did I miss?"

## Guardrails

- Do not replace a native plan unless the user asks. Build beside it.
- Do not pretend the companion has feedback until `get-plan-feedback` returns
  it or the user pastes it back.
- Do not use visual polish as a substitute for clarity. The point is review.
- Do not hand-roll MCP HTTP requests with curl. Use host-exposed tools after
  restart/reload, or use the returned browser/deep-link fallback.

---
name: ui-plan
description: >-
  Use Agent-Native Plans for UI-first planning with an optional top pan/zoom
  wireframe canvas, a refined Notion-like document, rich tabs, diagrams,
  comments, drawing, and agent handoff.
metadata:
  visibility: exported
---

# UI Plan

Use `/ui-plan` when the task is primarily about product UI, user flows,
interaction states, component layout, responsive behavior, or visual direction.
This is a specialized Agent-Native Plans workflow: the reviewable UI comes
first, and implementation details come after the user has something concrete to
react to.

`/visual-plan` remains the general rich planning command for architecture,
backend, refactors, migrations, and mixed work. Use `/visualize-plan` when a
text plan already exists and should become an HTML companion.

## UI-First Workflow

1. Call `create-ui-plan` with a UI-specific title, brief, source, repo path,
   and a complete bespoke `html` document whenever possible.
2. When the plan has meaningful UI flows, screens, or diagrams, make the top
   of the document a bounded pan/zoom sketch canvas with the key artboards,
   connectors, margin notes, and commentable visual anchors.
3. Continue below the canvas as a restrained, Notion-like interactive document:
   clear prose, horizontal state tabs, inline wireframes, sketchy diagrams,
   tables, vertical code tabs, and concise implementation notes.
4. Skip the top canvas when wireframes or diagrams would not clarify the work;
   in that case, keep the plan as a clean rich document.
5. Put files, symbols, data/actions, migrations, risks, and validation lower in
   the document after the visual review area.
6. Call `get-plan-feedback` before implementation, after review, after a long
   pause, and before the final response. Apply changes with
   `update-visual-plan`.

## Mockup Quality Bar

- Build high-fidelity screen sections with realistic spacing, controls,
  hierarchy, text, and state-specific content. Avoid vague gray boxes.
- Show the actual workflow the user will use: navigation, toolbar actions,
  forms, dialogs, empty states, error recovery, loading affordances, and
  confirmation/success states.
- Include desktop and mobile/responsive states when layout decisions could
  change. Put them in tabs or adjacent panels rather than burying them in prose.
- Use concrete labels and copy placeholders that expose content length,
  truncation, disabled states, and destructive actions.
- Make state tabs span the plan content width. Small cards are fine for repeated
  items, but the primary UI preview should not be trapped in a tiny thumbnail.
- Keep visuals review-focused, not decorative. Do not make a marketing page,
  hero section, brand deck, or abstract mood board unless the user asks.

## State Tabs

When showing multiple UI states, use the Plans tab attributes so the iframe
runtime wires up the interaction:

- Put `data-plan-tabs` on the tab group.
- Put `data-tab-target` on each tab button.
- Put matching `data-tab-panel` values on panels.

Good state tab sets include:

- `Default`, `Loading`, `Empty`, `Error`
- `List`, `Detail`, `Edit`, `Confirm`
- `Desktop`, `Tablet`, `Mobile`
- `Owner`, `Reviewer`, `Signed out`

## UI Flow Document

Generated `/ui-plan` documents use one default shape: an optional Figma-style
pan/zoom visual preface followed by a refined Notion-like document. There is no
mode boolean. Provide `states` and `components` when the top canvas will help
the reviewer understand the flow; omit them when the plan should be
document-only. You may pass `sketchiness` from `0` to `100`; omit it for the
default hand-drawn strength.

The document below the canvas should still include the same planning substance:
screen states, component notes, implementation map, review prompts, comments,
drawing-friendly space, and agent handoff. Treat it like a designer handed over
a Figma file plus a crisp product spec: the reviewer should understand the UI
flow from a bird's-eye view, then keep scrolling into a clean interactive
document with notes explaining how the screens work together.

## Comments, Drawing, And Handoff

- Add visible annotation prompts beside the mockups: "Comment on layout",
  "Circle unclear copy", "Mark missing state", or "Pick this option".
- Leave enough whitespace around key UI regions for drawing and callouts.
- Label important regions so comments can reference them without ambiguity.
- Include an "Agent Handoff" section after the mockups that summarizes the
  chosen UI direction, unresolved visual questions, and feedback that must be
  read before code changes.
- Never claim feedback has been applied until `get-plan-feedback` or the user
  has supplied the feedback in chat.

## Implementation Details Lower Down

After the visual canvas and document review blocks, include a concise
implementation section:

- file paths and symbols/components to touch;
- data/actions/hooks/routes needed for the UI;
- state ownership, optimistic updates, and sync expectations;
- accessibility, responsive, and keyboard considerations;
- test and verification plan;
- short code-shape snippets only where they clarify the implementation.

Do not paste whole files or let implementation prose crowd out the mockups.
The purpose of `/ui-plan` is to get visual direction approved before the agent
starts editing.

## Tool Guidance

- `create-ui-plan`: create the UI-first HTML plan.
- `update-visual-plan`: revise mockups, state tabs, comments, or handoff notes.
- `get-visual-plan`: inspect the current plan and annotations.
- `get-plan-feedback`: read unconsumed reviewer comments before coding.
- `export-visual-plan`: export a review receipt when needed.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`.

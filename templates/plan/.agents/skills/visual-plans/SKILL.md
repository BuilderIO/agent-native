---
name: visual-plans
description: >-
  Use Agent-Native Plans when coding-agent work needs an interactive HTML plan
  document with diagrams, wireframes, mockups, prototypes, annotations, and
  comments.
---

# Agent-Native Plans

Agent-Native Plans is HTML plan mode for coding agents. Generate the kind of
plan you would normally write in Markdown, but as a polished, scannable HTML
document with visual blocks mixed in: diagrams, wireframes, mockups, prototype
options, tradeoff cards, and annotation prompts.

The goal is impatient review. The user should be able to react to visuals first
and read prose only where it helps.

## Install And Use

Users install Plans with the Agent-Native CLI:

```sh
agent-native skills add plans
```

That one command installs `/visual-plan` and `/visualize-plan` and registers the
hosted MCP app connector for supported hosts such as Claude Code and Codex.

Use `/visual-plan` for a fresh plan. Use `/visualize-plan` when there is already
a Codex, Claude Code, Markdown, or pasted text plan that should become an HTML
companion.

## Slash Commands

- `/visual-plan`: create a fresh rich HTML plan before implementation. Include
  a docs-level plan, visual architecture/flow diagrams, detailed wireframes or
  mockups when UI is involved, tradeoffs, open questions, and clear feedback
  prompts.
- `/visualize-plan`: import an existing Codex, Claude Code, Markdown, or pasted
  text plan and turn it into a visual companion. Preserve the plan's intent,
  then add diagrams, wireframes, option cards, and annotation prompts.

## When To Use

Create or update a visual plan when:

- the user asks for a plan, HTML plan, visual plan, plannotate-style review,
  diagrams, wireframes, mockups, prototypes, comments, or annotations;
- work is multi-file, ambiguous, long-running, risky, or UI-heavy;
- the user is unlikely to read a long text plan closely;
- architecture, data flow, UI direction, options, or open questions would be
  clearer visually;
- you need the user to react before implementation.

## Core Workflow

1. Call `create-visual-plan` with the title, brief, source, repo path, and plan
   sections before implementation.
2. Put the best possible plan document in `html` when you can. It should feel
   like a bespoke HTML version of a strong Markdown plan, not a dashboard.
3. Surface the returned Agent-Native Plans link or inline MCP App. In CLI hosts,
   ask the user to review the plan visually.
4. Call `get-plan-feedback` before editing, after review, after any long pause,
   and before final response.
5. Incorporate comments/corrections with `update-visual-plan`; update the HTML
   document when feedback changes the direction.
6. Export an HTML/JSON/Markdown receipt with `export-visual-plan` when the user
   wants a shareable artifact.

## Visual Defaults

- UI work gets wireframes, state mockups, or prototype sketches.
- Wireframes should be concrete enough to critique: show layout regions,
  controls, states, empty/loading/error paths, review affordances, and copy
  placeholders. Avoid vague rectangle-only sketches.
- Backend/refactor work gets architecture, sequence, data-flow, or dependency
  diagrams.
- Complex tradeoffs get two or three option cards with consequences.
- Open questions are surfaced as visual callouts, not buried in paragraphs.
- Long prose is split into readable document sections with clear headings.
- Include README-like details when helpful: command names, tool behavior,
  install flow, MCP/link fallback, data shape, and what is in or out of scope.
- Comments and corrections should feel plannotator-style: quick to add,
  structured enough for the agent to consume, and easy to share when the user
  chooses.

## Tool Guidance

- `create-visual-plan`: start one HTML plan per agent task/run.
- `visualize-plan`: create an HTML companion from an existing text plan.
- `update-visual-plan`: revise the plan document, sections, status, or comments.
- `get-visual-plan`: read the current plan document and annotations.
- `get-plan-feedback`: read unconsumed human feedback. Use it frequently.
- `export-visual-plan`: export HTML, Markdown fallback, and structured JSON.

## HTML Guidance

- Prefer semantic HTML with scoped CSS inside the document.
- Match Agent-Native's dark, restrained theme unless the user asks otherwise.
- Keep the first viewport legible: title, brief, and one strong visual or
  summary.
- Use tabs, accordions, or small interactions only when they make review faster.
- Do not paste huge HTML into chat. Store it in Plans and surface the MCP app or
  link.
- Hosted default: connect
  `https://plan.agent-native.com/_agent-native/mcp`. Do not put shared secrets
  in skill files.

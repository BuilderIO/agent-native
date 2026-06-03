---
name: visual-plans
description: >-
  Use Agent-Native Plans when coding-agent work needs an interactive HTML plan
  document with diagrams, wireframes, mockups, prototypes, annotations, and
  comments.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is HTML plan mode for coding agents. Generate the kind of
plan you would normally write in Markdown, but as a polished, scannable HTML
document with visual blocks mixed in: diagrams, wireframes, mockups, prototype
options, tradeoff cards, and annotation prompts.

Install with the Agent-Native CLI. It adds the skills and MCP connector:

```bash
npx @agent-native/core@latest skills add plans
```

Then start typing `/visual-plan` for a fresh plan or `/visualize-plan` to turn
an existing Codex, Claude Code, Markdown, or pasted plan into a visual companion.

## Slash Commands

- `/visual-plan`: create a fresh rich HTML plan before implementation. Include
  a docs-level plan, visual architecture/flow diagrams, detailed wireframes or
  mockups when UI is involved, tradeoffs, open questions, and clear feedback
  prompts.
- `/visualize-plan`: import an existing Codex, Claude Code, Markdown, or pasted
  text plan and turn it into a visual companion. Preserve the plan's intent,
  then add diagrams, wireframes, option cards, and annotation prompts.

## Workflow

1. Call `create-visual-plan` with a title, brief, source, repo path, sections,
   and ideally a complete bespoke `html` document.
2. Surface the returned inline MCP App or browser link.
3. Ask the user to react to diagrams, wireframes, mockups, options, and open
   questions.
4. Call `get-plan-feedback` before implementation and after review.
5. Use `update-visual-plan` to revise the plan document or comments.

## Tools

- `create-visual-plan`
- `visualize-plan`
- `update-visual-plan`
- `get-visual-plan`
- `get-plan-feedback`
- `export-visual-plan`

## Quality Bar

- Wireframes must be concrete enough to critique: layout regions, controls,
  states, empty/loading/error paths, review affordances, and copy placeholders.
- Include README-like details when helpful: command names, tool behavior,
  install flow, MCP/link fallback, data shape, and what is in or out of scope.
- Avoid vague rectangle-only sketches and generic dashboards.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`.

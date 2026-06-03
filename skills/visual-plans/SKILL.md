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

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`.

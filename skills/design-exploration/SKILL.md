---
name: design-exploration
description: >-
  Use Agent Native Design for UI exploration, side-by-side design directions,
  interactive prototype previews, human selection, iteration, and coding
  handoff through the hosted Design MCP app.
metadata:
  visibility: exported
---

# Design Exploration

Use Design when a workflow needs complete UI/UX prototypes, several visual
directions to compare, or a human-in-the-loop pick before implementation.

## Setup

This skill installs instructions only. The hosted MCP connector must also be
available in the agent host:

```bash
npx @agent-native/core@latest connect https://design.agent-native.com
```

For cross-app workspace access, connect Dispatch instead:

```bash
npx @agent-native/core@latest connect https://dispatch.agent-native.com
```

OAuth-capable hosts can add this remote MCP URL directly:

```text
https://design.agent-native.com/_agent-native/mcp
```

## Exploration Flow

1. Create a project shell with `create-design`.
2. Generate 2-5 complete HTML directions, three by default.
3. Call `present-design-variants` with the directions and wait for the user to
   choose one.
4. Refine the chosen direction with `get-design-snapshot` and `generate-design`.
5. Use `export-coding-handoff` when the user wants to implement the result in a
   codebase.

Inline MCP hosts render the variant picker in chat. CLI and code-editor hosts
return an "Open in Design ->" link; after the user picks, continue from the
pasted handoff summary or from a plain-language pick like "use direction B".

## Prototype Rules

- Return complete, self-contained HTML documents.
- Use Tailwind CSS v4 via `@tailwindcss/browser@4`.
- Use Alpine.js for interaction.
- Make variants genuinely distinct in structure, typography, color, and mood.
- For product/app surfaces, prefer dense, scan-friendly layouts over marketing
  hero pages.
- For landing or brand surfaces, use expressive imagery or full-bleed visual
  scenes rather than generic gradients.
- Keep text readable, responsive, and non-overlapping on mobile and desktop.

## Guardrails

- Do not call `generate-design` while a variant picker is waiting for a user
  selection.
- Do not hardcode secrets or auth material in skill files.
- Do not skip the user pick for open-ended exploration unless the user asks for
  a single direction.

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

Recommended install path:

```bash
npx @agent-native/core@latest skills add design-exploration
```

That installs these instructions and registers the hosted Design MCP connector
for the selected agent client. Add `--client claude-code`, `--client codex`, or
`--client all` when needed.

For CLI/code-editor clients, keep the install/connect command running until the
browser authorization finishes. Stopping it early can leave the browser approved
but the local MCP config unwritten. Restart or reload the agent client after
installing or connecting if the Design tools do not appear in the live session.

If this skill was installed with the Vercel/open Skills CLI
(`npx skills add ...`), only the instructions were installed. That CLI does
not run postinstall scripts or register MCP connectors, so the hosted MCP
connector must be added separately:

```bash
npx @agent-native/core@latest connect https://design.agent-native.com --client claude-code
```

For cross-app workspace access, connect Dispatch instead:

```bash
npx @agent-native/core@latest connect https://dispatch.agent-native.com --client claude-code
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

- If a Design tool call returns `Session terminated`, `needs auth`, or another
  connector/session error, do not keep retrying the tool. Stop and give the user
  the reconnect step: in Claude Code run `/mcp` and choose
  Authenticate/Reconnect for the Design connector; from any terminal run
  `npx -y @agent-native/core@latest reconnect https://design.agent-native.com` — this
  re-authenticates WITHOUT reinstalling. Never reinstall from scratch just to
  fix auth. Continue once the connector is available.
- Do not hand-roll MCP HTTP requests with curl from the agent session. Use the
  host-exposed Design tools after restart/reload, or use the returned
  browser/deep-link fallback.
- If you inspect local MCP config, redact `Authorization`, `http_headers`, and
  token values. Never paste bearer tokens into chat or logs.
- Do not call `generate-design` while a variant picker is waiting for a user
  selection.
- Do not hardcode secrets or auth material in skill files.
- Do not skip the user pick for open-ended exploration unless the user asks for
  a single direction.

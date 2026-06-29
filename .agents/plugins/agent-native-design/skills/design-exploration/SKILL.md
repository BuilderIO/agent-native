---
name: design-exploration
description: >-
  Use Design for UI/UX exploration, side-by-side design directions,
  interactive prototype previews, user selection, iteration, and design-to-code
  handoff through the hosted Design MCP app.
metadata:
  visibility: exported
---

# Design Exploration

Use the Design app when a workflow needs visual UI exploration, prototype
iteration, or a human-in-the-loop choice among design directions.

## Choose The Path

- Use `create-design` first to create a project shell. Do not report the
  design as ready until it has renderable HTML.
- For open-ended UX exploration, generate distinct, complete HTML directions
  (2-5, three by default) and call `present-design-variants`. The inline
  Design MCP app shows the options, lets the user pick one, and persists the
  selected variant.
- If the Design app opens as a browser link instead of inline (CLI hosts like
  Codex / Claude Code, where the deep link carries `handoff=chat`), the user
  picks a direction there and the editor shows a copyable summary — ask them to
  paste it back into chat so you can continue from the chosen direction. The
  `present-design-variants` result's `fallbackInstructions` describe this.
- For direct refinements to an already chosen direction, call
  `get-design-snapshot`, edit from the current tuned HTML, then call
  `generate-design`.
- Use `export-coding-handoff` when the user wants to implement the chosen
  design in a codebase.

## Exploration Defaults

1. Default to three variants unless the user asks for a different count
   (`present-design-variants` accepts 2-5; three is the sweet spot).
2. Make variants structurally and stylistically distinct, not just color swaps.
3. Each variant must be a complete standalone HTML document that renders
   without a build step.
4. For product UI redesigns, prefer cleaner hierarchy, progressive disclosure,
   and realistic controls over decorative mockups.
5. After `present-design-variants`, wait for the user's pick before
   generating the next version. If they say "I like #2 but...", snapshot the
   chosen design and refine that direction with `generate-design`.

## Cross-App Use

- Hosted default: connect `https://design.agent-native.com/_agent-native/mcp`.
  Do not put shared secrets in skill files.
- For CLI/code-editor clients, keep any `npx @agent-native/core@latest connect` command
  running until browser authorization finishes. Stopping it early can leave the
  browser approved but the local MCP config unwritten. Restart or reload the
  agent client after installing or connecting if Design tools do not appear in
  the live session.
- Dispatch can expose Design alongside other apps. Use Design for UI/UX design
  tasks, Assets for image/media selection, Slides for decks, and so on.
- Keep the loop visual: surface the inline MCP App or the returned "Open
  design" link instead of pasting large HTML blobs into chat.
- If a Design tool call returns `Session terminated`, `needs auth`, or
  another connector/session error, do not keep retrying the tool. Stop and give
  the user the reconnect step: in Claude Code run `/mcp` and choose
  Authenticate/Reconnect for the Design connector; from any terminal run
  `npx -y @agent-native/core@latest reconnect https://design.agent-native.com` — this
  re-authenticates WITHOUT reinstalling. Never reinstall from scratch just to fix
  auth. Continue once the connector is available.
- Do not hand-roll MCP HTTP requests with curl from the agent session. Use the
  host-exposed Design tools after restart/reload, or use the returned
  browser/deep-link fallback.
- If you inspect local MCP config, redact `Authorization`, `http_headers`,
  and token values. Never paste bearer tokens into chat or logs.

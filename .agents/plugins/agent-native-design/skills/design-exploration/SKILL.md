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
  (2-5, three by default) and call `present-design-variants`. Design saves
  every option as a normal screen on the overview board and renders an inline
  chat choice with one button per screen name. After the user picks, delete the
  unchosen variant screens and continue from the kept screen.
- If the chat choice buttons are not available in the host, ask the user to
  tell you the screen name they prefer. The variants are already real screens
  on the board, so do not ask them to paste HTML or copy a generated handoff
  summary.
- For direct refinements to an already chosen direction, call
  `get-design-snapshot`, edit from the current tuned HTML, and use
  `edit-design` for surgical changes. Use `generate-design` for new files
  or larger structural rewrites.
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
   generating the next version. Keep the chosen screen, delete the other
   variant screens, then refine that direction with `generate-design` or
   `edit-design`.

## Design Quality Bar

- Before generating, name the concrete audience, the screen's primary job, and
  the visual thesis. If the brief is vague, make a reasonable choice and state
  it instead of producing a generic dashboard/landing-page default.
- For existing products, inspect the current screen, design system, tokens,
  component language, or codebase context before inventing a new direction.
- Make each direction distinct in structure and behavior, not just palette.
  Give every variant one memorable signature choice, then keep the surrounding
  chrome disciplined.
- Treat copy, data, and imagery as design material. Use realistic domain
  content and first-party/generated assets when images matter; avoid lorem
  ipsum, vague SaaS filler, and decorative placeholder boxes.
- Build to a quiet quality floor: responsive desktop/mobile layout, visible
  keyboard focus, useful loading/empty/error states for app UI, and reduced
  motion support when custom motion is present.
- After broad generation or refinement, inspect the rendered Design surface or
  a screenshot-capable host before calling it ready. Fix obvious hierarchy,
  overflow, contrast, broken interaction, and placeholder-content issues first.

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

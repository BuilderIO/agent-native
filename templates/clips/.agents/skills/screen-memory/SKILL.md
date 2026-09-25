---
name: screen-memory
description: >-
  Screen Memory — the disabled-by-default, local-only desktop buffer of recent
  screen/app/window context, plus its status and query actions.
  Use when the user asks what was on screen recently, or when reading,
  exporting, enabling, or describing Screen Memory.
---

# Screen Memory

## Rule

Screen Memory is a disabled-by-default, local-only desktop buffer of recent
screen, app, and window context. It is not a hosted Clips recording, and never
describe it as hosted, shared, exhaustive, or enabled by default.

## Reading it from the in-app agent

1. Call `get-screen-memory-status` before relying on it at all.
2. Then call `query-screen-memory-context` for bounded recent snippets when
   local context files are present.

If the local Screen Memory MCP built-in is connected, the agent may also use
`screen_memory_status`, `screen_memory_recent_context`, and
`screen_memory_recent_segments`. Only inspect or export segment file paths when
the user explicitly asks.

## User control and external agents

Users enable, pause, export, and clear the buffer from the desktop tray
settings. External local agents can read recent app/window context through
`agent-native mcp screen-memory`.

Do not upload raw Screen Memory segments or treat them as shareable Clips unless
the user explicitly exports and imports them.

## Related skills

- `recording` — the hosted capture path Screen Memory is not part of.
- `security` — why local-only context stays local.
- `context-awareness` — the supported way the agent learns what is on screen
  inside Clips.

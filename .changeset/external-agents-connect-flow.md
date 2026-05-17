---
"@agent-native/core": patch
---

Harden and complete external-agent MCP connect flows for hosted and local apps.

- A connect-minted token (or `mcp install` / ACCESS_TOKEN / production caller)
  now gets the full MCP tool surface — including mutating template actions
  like `create-document` — even in local dev, matching the documented
  external-agents contract. Previously a connected Claude Code/Codex/Cowork
  only saw framework builtins in dev, so "say it and it does it" didn't work
  against a local app.
- `list_apps` now reports the live request origin and `running: true` for the
  app serving the request, instead of a guessed `PORT || 5173` URL with
  `running: false` (which mis-pointed cross-app deep links on non-default
  dev ports).
- The in-app Connect page now auto-refreshes "Your connections" after a
  device authorize, so the new connection appears (with a "Connected"
  confirmation) without a manual reload.

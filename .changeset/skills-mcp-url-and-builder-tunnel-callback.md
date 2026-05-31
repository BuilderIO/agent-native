---
"@agent-native/core": patch
---

CLI + Builder connect: support custom / tunnel origins for local dev.

- `agent-native skills add` gains a `--mcp-url <url>` flag to register the
  app-backed MCP connector against a custom origin — an ngrok tunnel, a local
  dev server, or a self-hosted deployment — instead of the built-in hosted
  default. A bare origin gets the standard `/_agent-native/mcp` path appended.
- Fix the "Connect Builder" cli-auth callback when the app is reached via a
  tunnel (e.g. ngrok) whose origin Builder's `/cli-auth` does not trust:
  instead of handing Builder the rejected origin — which makes Builder fall
  back to its own dead `http://localhost:10110/auth` (ERR_CONNECTION_REFUSED) —
  fall back to the app's own `http://localhost:<PORT>` in local dev, an origin
  Builder accepts and a same-machine browser can reach. Production origins
  (`*.agent-native.com`) pass the allow-list and are unaffected.

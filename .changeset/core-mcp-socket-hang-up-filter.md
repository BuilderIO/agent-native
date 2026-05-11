---
"@agent-native/core": patch
---

Stop `Error: socket hang up` unhandled rejections from polluting Sentry on
AWS Lambda (Sentry AGENT-NATIVE-BROWSER-4 — 24k events / 199 users in 48h).
The MCP `StreamableHTTPClientTransport` opens long-lived sockets for SSE
long-polls; AWS reaps those sockets ~60s after a Lambda invocation returns
200, and the next thaw delivers a `Socket.socketOnEnd` whose Promise has
nobody left to await it. Two changes:

- `server/sentry.ts` `beforeSend` drops `socket hang up` events whose
  mechanism is `onunhandledrejection` and whose stack includes
  `Socket.socketOnEnd` / `node:_http_client`. Real socket-hang-up errors
  with a different mechanism or non-HTTP-client stack still report.
- `mcp-client/manager.ts` attaches a no-op `transport.onerror` before
  `client.connect()` so SDK fire-and-forget paths (initial SSE stream
  open, scheduled reconnects) can't surface as unhandled rejections in
  the window before Client wires its own handler. `Client.connect()`
  chains its own onerror on top of ours, so post-connect errors still
  flow through the existing `client.onerror` recorder.

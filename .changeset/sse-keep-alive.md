---
"@agent-native/core": patch
---

Keep the `/_agent-native/events` stream from reading as a hung handler. The SSE
endpoint opened and emitted nothing until a DB change arrived, so on Workers
the runtime cancelled the request as hung — which under `wrangler dev` surfaced
to the dev proxy as "Network connection lost" and killed the whole server,
taking any in-flight background agent run with it. The stream now emits a named
`keep-alive` frame immediately and every 15s; being a named event, it never
reaches the client's `onmessage`.

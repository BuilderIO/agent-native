---
"@agent-native/core": patch
---

Durable background agent-chat runs now actually receive Netlify's 15-min async
budget by reaching a STANDALONE background function at its DIRECT url, bypassing
Nitro's synchronous `/*` catch-all.

The previous emit wrote the background function into `.netlify/functions-internal`
with a custom `config.path` of the `_process-run` route. A custom `config.path`
makes a function reachable ONLY at that path (not at its default function url),
`functions-internal` is not exposed at a default url, and Netlify routed
`/_agent-native/agent-chat/_process-run` to the synchronous Nitro `server`
catch-all instead — so the worker was capped at the ~60s wall and degraded to
40s-chunked runs (confirmed live: a POST to the process-run path returned a
synchronous 401 from the handler rather than a 202 async ack).

The build now emits a standalone function into the STANDARD
`.netlify/functions/server-agent-background` dir with `background: true` and NO
custom `path`, so Netlify exposes it at `/.netlify/functions/server-agent-background`
and invokes it asynchronously (immediate 202 ack, 15-min budget). Its entry sets
`globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true` at cold start and rewrites
the incoming request path back to the `_process-run` route before delegating to
the Nitro handler, preserving the method, all headers (the HMAC
`Authorization: Bearer` the plugin verifies survives the rewrite), and the body.
The foreground self-dispatch (and server-driven continuation chunks) now target
that direct url on hosted Netlify via a shared `resolveAgentChatProcessRunDispatchPath`
helper, and stay on the framework route everywhere else. The graceful inline
40s fallback on a dispatch fast-fail is unchanged.

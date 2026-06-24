---
"@agent-native/core": patch
---

Durable background agent-chat runs now reach Netlify's 15-min async function by
emitting the background function INTO the scanned functions dir with a real
`config.path`, and excluding that path from the Nitro `server` `/*` catch-all so
the match is unambiguous.

Grounded in the real Netlify build output: Nitro's `netlify` preset writes no
`netlify.toml` and no redirects — the `/*` catch-all is an in-code Functions API
v2 `config.path: "/*"` on `.netlify/functions-internal/server/server.mjs`.
Netlify scans exactly the configured `functionsDirectory`
(`.netlify/functions-internal`); `.netlify/functions/` is the build OUTPUT dir
(where `@netlify/build` later writes the zips + `manifest.json`) and is never
scanned. On CI, Netlify reads each scanned function's `export const config` to
build the manifest routes — so per-file `background`/`path` config is honored.

The build now emits the background function into
`.netlify/functions-internal/server-agent-background` (the scanned dir), sharing
the same `main.mjs` bundle, with `export const config = { background: true, path:
"/_agent-native/agent-chat/_process-run" }`. It also appends that path to the
`server` function's `config.excludedPath`, so the `/*` catch-all no longer
matches the process-run route. Netlify evaluates serverless functions before
redirects, so a POST to the framework process-run route matches only the async
background function (immediate 202 ack, 15-min budget) — never the synchronous
`server` catch-all. The entry sets
`globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true` at cold start and
normalizes the request path before delegating to Nitro, preserving the method,
all headers (the HMAC `Authorization: Bearer` the plugin verifies), and the body.

This supersedes the two earlier approaches that failed in production: emitting
into `functions-internal` with a `config.path` but WITHOUT excluding it from the
`/*` catch-all (both functions matched the path; the synchronous `server`
catch-all won, returning a sync 401 instead of a 202), and emitting a standalone
function into `.netlify/functions/` (never scanned, returned 404). The foreground
self-dispatch now always targets the framework process-run route on every host
via `resolveAgentChatProcessRunDispatchPath`. The graceful inline 40s fallback on
a dispatch fast-fail is unchanged.

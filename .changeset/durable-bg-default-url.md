---
"@agent-native/core": patch
---

Durable background agent-chat runs now reach Netlify's 15-min async function via
the function's DEFAULT url (`/.netlify/functions/<name>`) with NO custom
`config.path` and NO catch-all patch — the doc-correct approach per the Netlify
docs.

Every Netlify function is reachable at `/.netlify/functions/<name>` by default;
a custom `config.path` REMOVES that default url. The build now emits the
background function into the scanned dir
(`.netlify/functions-internal/server-agent-background`, or per-app
`<app>-agent-background` for workspaces), sharing the same `main.mjs` bundle,
with `export const config = { background: true, ... }` and NO custom path. The
function therefore keeps its default url, and `background: true` makes any
invocation of that url asynchronous (immediate 202 ack, 15-min budget). The
Nitro `server` function's `/*` catch-all already excludes `/.netlify/*`, so the
default-url namespace is never shadowed by the synchronous function — there is
nothing to patch.

The function entry rewrites the incoming pathname to the framework
`_process-run` route (base-path-prefixed for workspaces) before delegating to
Nitro, preserving the method, all headers (the HMAC `Authorization: Bearer` the
plugin verifies), and the body. It also sets
`globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true` at cold start so the
worker takes the 15-min soft-timeout. The foreground self-dispatch resolves the
function's default url on hosted Netlify (per-app name from
`AGENT_NATIVE_WORKSPACE_APP_ID`), and `fireInternalDispatch` strips the app base
path for `/.netlify/*` targets so the request reaches the host-root function
url. Off-Netlify (local dev, `netlify dev`, non-Netlify hosts), the foreground
dispatches to the framework process-run route, handled inline by the same
in-process catch-all.

This supersedes the earlier attempt that gave the function a custom
`config.path` (the framework route) plus a `server` `excludedPath` patch — that
custom path was not honored as a route in production (a probe of
`POST /_agent-native/agent-chat/_process-run` returned 404). The graceful inline
40s fallback on a dispatch fast-fail is unchanged.

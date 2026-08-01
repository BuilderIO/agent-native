---
"@agent-native/core": patch
---

Treat the Cloudflare Workers runtime as hosted for durable background runs, and
scope the long-budget signal to a single invocation there. Hosted detection now
reuses `isCloudflareRuntime()` — the same predicate the database layer relies on
— and counts the local Worker runtime as hosted, because `wrangler dev` runs the
real Worker runtime rather than a Node server; `AGENT_CHAT_DURABLE_BACKGROUND=false`
is the explicit opt-out that restores the inline streaming loop. On Workers a
worker may take the long budget only inside `runInBackgroundInvocationScope()`,
so a concurrent foreground turn sharing the isolate cannot observe it and be
killed when its client disconnects; the isolate-level marker is unchanged for
Netlify, the host it was written for. Until a queue transport is bound, an
enabled gate on Workers dispatches to the in-process route and says so once per
isolate instead of degrading silently.

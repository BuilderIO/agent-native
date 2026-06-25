---
"@agent-native/core": patch
---

Durable background agent runs: add a foreground **circuit-breaker** so a dead
background worker can no longer break chat. A Netlify async background function
returns `202` the instant it enqueues the invocation, but the worker may never
execute — e.g. the generated function wrapper fails to import `./main.mjs` or
hand off to the Nitro `_process-run` route, so it never reaches
`claimBackgroundRun` and the run is reaped as "worker never claimed the run".
After a successful dispatch the foreground now polls briefly for the worker to
actually claim the run; if it doesn't within the grace window, the turn is
recovered **inline** (the same safe atomic-claim path used for a fast dispatch
failure), so a dead worker degrades to a working synchronous turn instead of a
reaped failure. Also harden the generated background-function wrapper to pass
Netlify's `context` through to the Nitro handler and wrap the handoff in
try/catch so a pre-route failure is logged loudly instead of silently swallowed
behind the async 202.

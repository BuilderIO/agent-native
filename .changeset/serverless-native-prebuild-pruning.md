---
"@agent-native/core": patch
---

Fix the cold-start failure mode that turns a serverless page load into a burst of 502/504s, and stop the chat spinner from hanging forever when the run-status probe is unreachable.

**Container-killing 502.** `createCoreRoutesPlugin` rethrew after `rejectInit(error)`.
Nitro invokes plugins as `try { plugin(app) } catch`, which cannot catch an async
rejection, so that rethrow surfaced as an `unhandledRejection`: Node exits, the
serverless container dies, and every in-flight request on it returns a bare 502.
`rejectInit` already routes the failure to the readiness gate's retryable 503, so
the rethrow only destroyed the container.

**Unbounded readiness gate.** Requests to `/_agent-native/*` waited on plugin
bootstrap with no deadline, so a slow cold boot parked them until the platform
killed the invocation — the client got nothing it could act on. The gate now
releases after `AGENT_NATIVE_ROUTE_READY_TIMEOUT_MS` (default 25s, deliberately
below the shortest deployment target's request wall) and answers with a retryable
503 instead.

**155MB function bundles.** Serverless builds copied every platform variant of
`@libsql` and `@resvg` into the output — darwin, win32, android and 32-bit arm
binaries a Lambda can never execute, ~66MB of dead weight, paid again for each
additional emitted function. Cold start scales with bundle size, and a page that
opens several requests at once scales out to that many cold containers, which is
why this surfaced as 502/504 on a page's first burst rather than as a slow deploy.

**Eternal "Thinking…".** `AssistantChat` treated a failed `/runs/active` probe as
"no active run" and returned early. That probe is the only path that clears the
stored active run and no caller reschedules it, so a transient 5xx left the
spinner up permanently — surviving reloads, because the stored run lives in
`sessionStorage`. It now retries, then clears the stored run and raises a
recoverable `run_status_unavailable` error. `activeRunLooksStale` also falls back
to the heartbeat when a run was killed before recording any progress, so those
runs no longer read as perpetually fresh.

**Dead tools advertised in production.** `source-search` was registered for the
production agent even where its corpus is not deployed, so its only possible
answer was "not found". It is now registered only when the corpus exists, and
`docs-search` says when framework doc pages are absent from the deployment
instead of letting a miss read as "that page does not exist".

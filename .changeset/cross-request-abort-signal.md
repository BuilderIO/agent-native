---
"@agent-native/core": patch
---

Keep a queued agent turn alive when the run registry holds an AbortController
from another request context. On Cloudflare Workers the module-scope run
registry outlives a single request but its I/O objects do not, so a queue
consumer entering `startRun` for a thread the foreground POST already
registered would abort a controller it does not own and fail the invocation
with `background_worker_failed` before emitting any agent event. The run is now
retired normally and the undelivered signal is recorded on the run and reported
once per isolate, rather than being swallowed or taking the turn down.

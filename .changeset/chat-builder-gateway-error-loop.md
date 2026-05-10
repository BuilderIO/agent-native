---
"@agent-native/core": patch
---

fix(chat): stop the "agent regenerates the reply 4+ times in a loop" runaway when the Builder gateway emits a no-detail error

End-to-end repro on slides production showed the agent emitting `{activity, tool_start, tool_done, tool_start, tool_done, clear, clear, clear, error}` with `errorCode: "builder_gateway_error"`, then the client sending another `POST /agent-chat` to auto-continue, which got the same gateway error, which auto-continued again — up to **4 server runs for one user message** until the gateway returned 503. Each run wiped visible content via `clear` events and re-streamed from scratch. That's the "agent does some work, deletes its reply, regenerates, gets stuck in a loop" symptom users were hitting.

Two changes:

- **client (`sse-event-processor.ts`):** `builder_gateway_error` is no longer in `isAutoRecoverableError`'s recoverable list. That code is the no-detail Builder gateway fallback (gateway emitted `{type:"stop",reason:"error"}` with no explanation — almost always upstream provider giving up: model quota hit, account misconfiguration, opaque downstream failure). The production-agent already retries it synchronously inside the run before the error escapes to the SSE stream, so by the time the client sees it the server has given up — auto-continuing on top of that just sends another POST that hits the same wall. Surfaces the error to the user as a "Something went wrong" card instead of looping up to 32 transient continuations. Also removed `"gateway error"` from the message-substring matcher to stay consistent with the code-based check.

- **server (`production-agent.ts`):** Cap the in-run retry budget for `builder_gateway_error` at 1 (down from `MAX_RETRIES = 3`). Same rationale — retrying the same call against a misbehaving Builder route rarely recovers, and each retry emits a `clear` event that wipes the user's visible content. Three cycles of "regenerate, clear, regenerate" inside a single run is bad UX for a failure mode where retrying doesn't help. Other retryable codes (`http_5xx`, `builder_gateway_network_error`, rate limits, transport blips) keep the original 3-attempt budget. New `maxRetriesForError(err)` helper gates this so we can extend per-code overrides later without touching the loop.

---
"@agent-native/core": patch
---

Stop ending long agent chat turns early. The client's whole-turn follow budget was shorter than a single background chunk the server is allowed to run, so turns that were still streaming were cut off; it is now a backstop above the server's own limits, with a test pinning that order. Also explains the gateway's email-verification block instead of showing a dead-end error, and no longer claims a stopped turn was looping when it was still working.

Also require a provider key when an `ai-sdk:*` engine points at a public gateway. The keyless exemption was meant for a self-hosted gateway but accepted any `baseUrl`, so pointing at a hosted provider without a key sent an unauthenticated request that came back as `http_401` "Missing Authentication header" — a transport error naming the wrong cause, repeated on every retry. Only loopback, private-range, and `.local`/`.internal` hosts are exempt now.

Record the cause when a background continuation handoff fails. The run went terminal with `error_code` and `error_detail` both NULL, so every query read it as a failure with no known cause and the real message was only recoverable by parsing the `diag_stage` JSON blob.

Record why a cross-app (A2A) call ended on the `agent_call` event. The terminal code was already computed for telemetry but left off the persisted event, so a failed cross-app call was stored as "failed after N ms" with no reason — undiagnosable without a repro.

Attach the remote task id to every cross-app call, not only failed ones. A call that succeeded slowly carried no task id, so the question worth asking about a four-minute A2A call — what was the other app doing? — could not be traced into that app's own task record.

Index the `resources` cleanup filter. `cleanupExpiredAgentScratchResources` filters on `(visibility, expires_at)` with no index, and its 60s throttle is a module-scope timestamp that starts at 0 in a fresh isolate — so the first resource read after every serverless cold start full-scanned a table shared by every template and read from agent discovery, docs, chat scratch and remote-agent manifests.

Tell a delegated agent to reach for its own registered actions first. A cross-app callee was rediscovering its capabilities by exploring — and reaching for a shell to do what one of its own actions already did — which is why healthy Slides→Analytics calls took minutes. Added to the existing delegated-agent contract rather than a new prompt block.

---
"@agent-native/core": patch
---

Add opt-in durable background agent-chat runs (off by default). When enabled, a long in-app agent-chat turn is dispatched into a Netlify background function (15-min budget) instead of completing synchronously under the ~40s soft-timeout: the foreground POST claims the run slot, inserts the run row, fires an HMAC-signed self-dispatch to the process-run path, and returns the existing SSE subscription so the client streams the same events via the cross-isolate SQL-poll path with no client change. Behavior is unchanged unless the feature flag is set.

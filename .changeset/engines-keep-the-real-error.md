---
"@agent-native/core": patch
---

Make agent engine failures diagnosable and recoverable: record the `cause`
chain behind a bare "Connection error." / "fetch failed" instead of dropping
it, stop the Anthropic and AI SDK retry layers from multiplying the loop's own
retries, stop retrying once the next backoff would not fit the remaining run
budget, resume a resumable transport error in-process on the foreground while
budget remains, and stop letting a gateway keepalive release the 25s
first-model-event cap.

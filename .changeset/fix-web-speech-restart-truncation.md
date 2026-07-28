---
"@agent-native/core": patch
---

Fix browser live transcription silently freezing mid-recording. `useLiveTranscription` now restarts recognition off the event loop instead of synchronously inside `onend` (Chrome throws `InvalidStateError` there), retries a failed restart with backoff instead of giving up after one throw, and exposes `getIncompleteReason()` so callers can tell a partial capture from a finished one.

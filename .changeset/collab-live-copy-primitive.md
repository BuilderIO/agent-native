---
"@agent-native/core": patch
---

Add live copies to `@agent-native/core/collab`: a collab document whose Yjs state is the only writable copy of a body, with its text derived from that state on every commit. `defineLiveCopy` declares which documents are live copies, how their text is derived, and an optional `persist` hook that writes the app's own rows in the same transaction. `applyUpdate` commits client updates through it, `mutateLiveCopy` applies a server edit and retries on version conflicts, `seedLiveCopy` seeds an absent or empty copy, and `readLiveCopy` tells absent, empty and malformed state apart. Failures are a typed `LiveCopyError`; other collab write paths refuse live copies with `write_refused`.

Derives, seeds and heavy edits run in `createBoundedTaskRunner`: worker threads with a terminable deadline, a heap limit, input and output size limits, and a bounded queue. Where worker threads do not exist, runs fail with `unavailable` instead of running inline. Import a task module as `./tasks.ts?bounded-task` to bundle it at build time.

Passing `onContentSync` to `createCollabPlugin` now throws at startup. The option was declared but never called; use a `liveCopy` binding to derive a document's text instead. `createCollabPlugin` takes that binding and maps live-copy failures to HTTP 409, 413, 422 or 503.

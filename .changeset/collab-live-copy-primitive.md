---
"@agent-native/core": patch
---

Add live copies to `@agent-native/core/collab`: a collab document whose Yjs state is the only writable copy of a body, with its text derived from that state on every commit. `defineLiveCopy` declares which documents are live copies, the bounded task runner that does their Yjs work, and an optional `persist` hook that writes the app's own rows in the same transaction; `persist` may return `{ derived: false, reason }` to leave them alone. `applyUpdate` commits client updates through it, and once a binding is defined the update route's ack carries `liveCopy` (`derived`, `not_derived` or `unchanged`) and `liveCopyReason`. `mutateLiveCopy` applies a named edit and retries on version conflicts, `seedLiveCopy` seeds an absent or empty copy, and `readLiveCopy` tells absent, empty and malformed state apart. Failures are a typed `LiveCopyError`; other collab write paths refuse live copies with `write_refused`, and `getDoc`, `getText` and `getJson` refuse them with `read_refused`.

A live copy's Yjs merge, derive, seed and edits run only in `createBoundedTaskRunner`: worker threads with a terminable deadline, a heap limit, input and output size limits, and a bounded queue. Where worker threads do not exist, runs fail with `unavailable` instead of running inline. The runner's module exports `defineLiveCopyTasks(...)` from `@agent-native/core/collab/live-copy-tasks`; import it as `./tasks.ts?bounded-task` to bundle it at build time.

Passing `onContentSync` to `createCollabPlugin` now throws at startup. The option was declared but never called; use a `liveCopy` binding to derive a document's text instead. `createCollabPlugin` takes that binding and maps live-copy failures to HTTP 409, 413, 422, 500 or 503.

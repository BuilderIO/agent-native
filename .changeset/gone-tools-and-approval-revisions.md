---
"@agent-native/core": patch
---

When a run no longer has a tool the conversation used or loaded earlier, calling it returns `Error: Tool no longer available` instead of `Unknown tool`, the run's first request names loaded tools that went away, and a call the user approved stops the run instead of handing the model a "go ahead". Action entries accept an optional `revision`; one-time approvals and "Always allow" grants record it, and a changed revision asks the user again. Existing approval rows keep matching entries without a revision. `resolveAdditionalActions` also receives `threadId`, `requestedTurnId`, and `internalContinuation` for chat.

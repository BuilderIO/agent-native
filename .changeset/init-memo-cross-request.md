---
"@agent-native/core": patch
---

Stop a startup table-init from hanging every later agent chat turn on
Cloudflare Workers. `core-routes-plugin` fires `ensureObservabilityTables()`
outside any request; on Workers that DDL can never settle, and the module-scope
memo then handed the same never-settling promise to every subsequent caller, so
each chat turn stalled inside experiment resolution with no error, no run row,
and no LLM call — the UI sat on "Thinking" forever. The new `createInitMemo`
helper shares a pending init only within the invocation that started it and
shares only the settled result across invocations.

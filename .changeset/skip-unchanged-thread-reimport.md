---
"@agent-native/core": patch
---

Reduce agent-sidebar chat jank by skipping redundant thread re-imports on poll
ticks (`AssistantChat`'s `importThreadData`).

The real-time sync layer refetches the open thread (`/threads/:id`, or re-runs a
host `loadHistoryRepository`) on reconnect, on `historyReloadKey` bumps, and on
restore. Each call ran the full `JSON.parse` + `normalizeThreadRepository` +
`threadRuntime.export()`/`import` round-trip even when the payload was identical
to what was last imported — CPU-bound on long threads and a source of needless
re-render churn.

`importThreadData` now hashes the raw incoming payload and short-circuits when it
matches the last successfully-imported signature, returning the already-imported
repo. Any real change (new message, arriving tool result, server replacing an
optimistic copy, switching threads) produces a different signature and falls
through to a full import. Payloads that `shouldImportServerThreadData`
deliberately rejects are not cached, so rejection semantics and live token
streaming are unchanged.

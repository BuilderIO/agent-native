---
"@agent-native/core": patch
---

Speed up the agent sidebar and per-session polling.

- **Chat thread list** (`chat-threads/store.ts`): the sidebar list query no longer
  selects the full `thread_data` JSON blob (every thread's entire message
  history, tool results, and attachments) just to render titles and previews —
  it now reads only the summary columns and derives "has messages" from the
  `message_count` column instead of a `LIKE '%"messages"%'` scan over the blob.
  Legacy rows are backfilled once so none drop out of the list. Added
  `(owner_email, updated_at)` and `(scope_type, scope_id, updated_at)` indexes on
  `chat_threads` so the list is an indexed lookup instead of a full table scan +
  sort. The thread detail/get path still returns the full `thread_data`, and the
  compare-and-swap write path is unchanged. Indexes are dialect-agnostic.

- **Change-detection poll** (`server/poll.ts`): the independent reads in
  `doCheckExternalDbChanges()` now run concurrently via `Promise.all` instead of
  sequential awaits, cutting per-poll round-trips on the common path from ~6 to
  effectively 1. Dependent/conditional follow-up queries stay ordered, and
  change-emit order, early-exit semantics, and error handling are unchanged.

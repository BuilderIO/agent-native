---
"@agent-native/core": patch
---

Restore a reachable path for the legacy chat-thread `message_count` repair. Databases predating the column left rows at 0, and both `listThreads` and `searchThreads` filter `message_count > 0` in SQL, so those threads never appeared in the sidebar and nothing called the repair anymore.

`repairLegacyChatThreadMessageCounts` now runs as a name-tracked migration (`_chat_threads_migrations`), so the `thread_data` scan happens once per database and is skipped entirely on every later boot rather than on every cold start. `MigrationEntry` gained an optional `run` hook for backfills SQL cannot express; it executes before the bookkeeping row is written, so a failed repair stays unrecorded and retries instead of being marked applied against work that never happened.

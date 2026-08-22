---
"@agent-native/core": patch
---

Cut seconds off chat list reads and serverless cold starts.

- `listThreads`/`searchThreads` no longer filter on `thread_data`. Matching that
  blob detoasted the entire message history for every scanned row before `LIMIT`
  applied; measured on production beta, the same 20-row response went 2207ms →
  222ms with the predicate removed. Schema migration 3 backfills
  `source_platform` for the legacy integration rows the predicate used to catch.
- Added expression indexes for the access-scoping predicates that wrap columns in
  `LOWER()` — `chat_threads`, `chat_thread_shares`, and `token_usage`. A plain
  btree cannot serve a function-wrapped comparison, so these lists were scanning
  whole shared tables.
- Moved `clientAbortReason` into a leaf module so the agent chat server plugin no
  longer pulls the agent run loop into its static import graph. That graph costs
  ~1.2s to evaluate and every cold serverless start paid it, including requests
  that only render a page.

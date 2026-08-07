---
"@agent-native/core": patch
---

Fix the `sync_events` retention prune, which planned as a sequential scan of
the entire table. It now deletes by the already-indexed `version` column
(monotonic epoch milliseconds) in bounded batches, oldest first, and reports a
failure instead of swallowing it. On one production app the old statement was
scanning a 47 GB table roughly 60 times concurrently, and a prune that never
succeeded was indistinguishable from one with nothing to do.

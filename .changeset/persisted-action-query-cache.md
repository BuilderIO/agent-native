---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Revisits paint the last known action results instead of a skeleton. Action query results are persisted per signed-in user and org in IndexedDB, restored before any action request is issued, then refetched in the background. Entries are dropped on sign-out, session end and org switch, after an hour, when a refetch returns 403 or 404, or when the cache schema version changes. Mutations are never persisted. Set `persistInBrowser: false` on an action definition to keep its reads out of the browser cache.

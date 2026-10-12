---
"@agent-native/core": patch
---

Send a `useActionQuery` query's first fetch as its own request, and batch only its refetches of data already in the cache, so a fresh page load no longer waits behind unrelated reads queued on one serverless database connection. Queries whose UI waits for a fresh read can pass `batchRefetches: false`. GETs made through `callAction`, including custom `useQuery` functions built on it, are no longer batched.

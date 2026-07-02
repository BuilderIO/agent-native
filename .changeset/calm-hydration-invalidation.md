---
"@agent-native/core": patch
---

Prevent client fetch storms during high-volume background mutations: `useActionMutation` accepts `skipActionQueryInvalidation` so background mutations can perform narrow invalidation instead of refetching every action query, `useDbSync` accepts `suppressActionInvalidationFor` to skip whole-action-cache invalidation for named high-volume action sync events, and action-query retries are bounded to one attempt for network-level failures (Chrome reports connection-pool exhaustion as a generic fetch failure, so unbounded retries sustained the storm).

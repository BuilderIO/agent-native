---
"@agent-native/core": patch
---

Eliminate duplicate org_members round trip on authenticated SSR requests: per-event memoize getOrgContext and reuse session.orgId when already backfilled.

---
"@agent-native/core": patch
---

Export `mutateOrgSetting` from `@agent-native/core/settings` alongside the other org-scoped helpers, so app code can perform atomic read/merge/write updates on org settings instead of racing separate `getOrgSetting`/`putOrgSetting` calls.

---
"@agent-native/core": patch
---

Fix a split-brain in credential resolution: `resolveCredential` (and its diagnostic sibling `describeCredentialScopeGap`) only ever searched the single org on `ctx.orgId`. Interactive requests always populate it, but CLI runs, cron/recurring jobs, and any other caller built from `getCredentialContext()` outside a request event do not — so an org-scoped key that shows "Ready" in Settings silently missed at runtime for those callers. Both functions now fall back to resolving the caller's org from their email when `ctx.orgId` is unset, and a membership lookup that fails to read now throws a retryable error instead of being reported as "not configured". `resolveRequiredCredential` in the provider-api layer now also appends the scope-gap diagnostic to its error, matching `resolveAnyCredential`.

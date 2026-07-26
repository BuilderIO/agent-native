---
"@agent-native/core": patch
---

Credential resolution now distinguishes "no credential" from "could not read
the credential store". A transient database failure during org membership or
`app_secrets` lookup surfaces as a retryable error instead of the permanent
"No LLM provider is connected" / "Builder keys are not configured" copy, and a
failed org lookup is no longer memoized as "no org" for the rest of the
request. `org_members` reads now go through one shared helper so the scheduler
and org context cannot disagree about what a failed read means.

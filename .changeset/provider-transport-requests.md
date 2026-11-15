---
"@agent-native/core": patch
---

Provider API requests accept WebDAV `PROPFIND` and `REPORT` methods. A runtime created with `unsafeRequestPolicy: "single-attempt"` sends each non-GET/HEAD request at most once (no quota retries, no unsafe pagination) and advertises this as `requestCapabilities.singleAttemptUnsafeRequests`. Google service-account tokens honor the request's abort signal and timeout, never cache a cancelled exchange, and are bound to the selected workspace connection: an explicit `connectionId` whose credential is missing or revoked fails instead of falling back to another credential. Every provider request is now recorded in the per-app provider call census.

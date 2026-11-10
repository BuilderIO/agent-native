---
"@agent-native/core": patch
---

Let `A2AClient` callers trust extra operator-configured private origins with the `allowedPrivateOrigins` option, on top of the workspace origins the SSRF guard already allows.

---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Say why a workspace app answers 503 "Workspace app access is temporarily unavailable". The response now carries a `code` (and, when a Dispatch registry reply arrived, `upstreamStatus`, `audience`, and `detail`), the cause is logged once per instance, and Dispatch's 401 for a refused registry token names the check that refused it (`token-not-verified:signature`, `token-not-verified:audience`, `token-without-user`, `org-unknown`, `not-org-member`).

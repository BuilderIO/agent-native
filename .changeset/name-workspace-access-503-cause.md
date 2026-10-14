---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Say why a workspace app answers 503 "Workspace app access is temporarily unavailable". The 503 body now carries a `code` (and, when a Dispatch registry reply arrived, `upstreamStatus`, `audience`, and `detail`), and each cause is logged once per instance. A new `checkWorkspaceAppAccess` returns the cause; `isWorkspaceAppAccessAllowed` keeps its `true` / `false` / `"unavailable"` contract. Dispatch's 401 for a refused registry token names a coarse reason (`token-not-verified`, `token-without-user`, `org-unknown`, `org-mismatch`, `not-org-member`) and logs the finer cause server-side only.

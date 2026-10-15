---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Say why a workspace app answers 503 "Workspace app access is temporarily unavailable". The 503 body now carries a `code` (and, when a Dispatch registry reply arrived, `upstreamStatus`, `audience`, and `detail`), and each cause is logged once per instance. A new `checkWorkspaceAppAccess` returns the cause; `isWorkspaceAppAccessAllowed` keeps its `true` / `false` / `"unavailable"` contract. Dispatch logs why it refused a registry token (server-side only; the 401 stays a fixed refusal), using the new `diagnoseA2ATokenFailure` from `@agent-native/core/a2a`.

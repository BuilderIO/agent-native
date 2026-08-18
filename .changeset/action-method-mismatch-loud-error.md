---
"@agent-native/core": patch
---

Fix `useActionQuery`/`useActionMutation`/`callAction` surfacing an opaque `405` when a caller's HTTP verb doesn't match an action's declared `http.method` (e.g. a `defineAction({ http: { method: "DELETE" } })` called without `{ method: "DELETE" }`). The transport now throws a typed `action_method_mismatch` error naming the action, the method that was sent, and the method it declares, instead of a bare "Method not allowed" the caller had to reverse-engineer — and marks it non-retryable, since resending the same wrong verb never succeeds.

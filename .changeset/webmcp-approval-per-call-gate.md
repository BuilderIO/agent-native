---
"@agent-native/core": patch
---

WebMCP no longer excludes an action just because it declares `needsApproval`. The action stays discoverable, and a call is refused with an `approval_required` error telling the caller to ask the user to confirm in chat only when that call's actual arguments trip the predicate.

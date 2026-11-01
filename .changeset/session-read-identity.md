---
"@agent-native/core": patch
---

Add `sessionReadIdentity()` and `sessionReadIdentityStatus()` to `use-session`, so a request can record whom it was sent as (the session read its cookies belong to, and the transport it went out on) and be checked against the session the tab accepts before its answer is shown.

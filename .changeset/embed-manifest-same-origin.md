---
"@agent-native/core": patch
---

Keep the dev React Router browser manifest relative for same-origin requests, so client-side navigation works behind proxies that rewrite the Host header (such as Builder Fusion's preview).

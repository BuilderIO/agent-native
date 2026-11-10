---
"@agent-native/toolkit": patch
---

Fix Google sign-in failing with `Invalid desktop exchange challenge.` on apps with a stricter Google auth route, such as Clips. The browser redirect no longer carries a desktop `flow_id`.

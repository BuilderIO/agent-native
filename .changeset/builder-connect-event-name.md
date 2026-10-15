---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

One-click Builder.io account creation now records `cta_clicked` for its `builder_connect_clicked` click, like the sign-in popup path, and tags its `builder_connect_failed` event with `connect_url_kind: "provision"`. The tracking docs now name `builder_connect_clicked`, the event that counts clicks on both paths.

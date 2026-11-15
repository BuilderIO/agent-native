---
"@agent-native/core": patch
---

Workspace deploy build cache ignores the per-run GitHub artifact and systemd process variables, so a restored CI cache can hit.

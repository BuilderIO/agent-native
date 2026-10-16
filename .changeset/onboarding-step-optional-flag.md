---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

First-run onboarding step events carry `optional`, true when the screen offers a skip, so Analytics funnels can tell a skip from drop-off. First-run extensions declare it with `optional: true`.

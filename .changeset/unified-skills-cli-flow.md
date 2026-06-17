---
"@agent-native/core": patch
"@agent-native/skills": patch
---

Unify the skills CLI flow so `@agent-native/skills` delegates normal user-facing
list/add flows to the core skills CLI with an expanded public skills catalog,
while `agent-native skills` keeps the Agent Native-only catalog.

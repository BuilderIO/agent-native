---
"@agent-native/skills": patch
---

Prompt for install scope (project vs user) during interactive installs when
`--scope`/`-g`/`--project` is not passed, instead of silently defaulting to
user scope. Explicit flags and non-interactive runs are unchanged.

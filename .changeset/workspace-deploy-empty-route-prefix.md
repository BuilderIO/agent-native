---
"@agent-native/core": patch
---

Stop workspace deploys from forwarding an empty framework route prefix to app builds and generated functions, so workspace apps still pinned to an older Core no longer fail with "not a supported Agent-Native config path".

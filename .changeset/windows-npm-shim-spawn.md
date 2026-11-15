---
"@agent-native/core": patch
---

`agent-native create` from a local framework checkout (`AGENT_NATIVE_CREATE_USE_LOCAL_CORE=1`) works on Windows again: it packed local packages by starting `npm.cmd` without a shell, which current Node refuses with `spawnSync npm.cmd EINVAL`.

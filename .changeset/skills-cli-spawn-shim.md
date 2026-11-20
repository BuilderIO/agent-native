---
"@agent-native/core": patch
---

`agent-native skills` now starts `npx` through the same quoted Windows command-line handling as the other CLI commands, and the unused delegated-call metadata object in `call-agent` is removed.

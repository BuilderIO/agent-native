---
"@agent-native/core": patch
---

Report a build step killed by a signal (usually an out-of-memory kill on a small CI host) as its own error issue instead of grouping it with ordinary build failures.

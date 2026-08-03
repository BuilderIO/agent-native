---
"@agent-native/scheduling": patch
"@agent-native/pinpoint": patch
"@agent-native/dispatch": patch
"@agent-native/core": patch
---

Cap each vitest suite at a share of the machine through a shared root config so
concurrent test runs no longer oversubscribe the CPU. Defaults to 25% of cores;
override with `VITEST_CONCURRENCY`.

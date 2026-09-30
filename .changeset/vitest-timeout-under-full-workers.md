---
"@agent-native/core": patch
---

The shared Vitest config (`@agent-native/core/vitest-config`) now allows 30 seconds per test instead of Vitest's 5-second default, so tests that boot PGlite or import a server bundle no longer time out when test workers use every core.

---
"@agent-native/creative-context": patch
"@agent-native/scheduling": patch
"@agent-native/recap-cli": patch
"@agent-native/pinpoint": patch
"@agent-native/dispatch": patch
"@agent-native/toolkit": patch
"@agent-native/skills": patch
"@agent-native/core": minor
---

Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
config merges it in.

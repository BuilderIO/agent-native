---
"@agent-native/core": patch
---

Add `measureCpuMs` at `@agent-native/core/testing/cpu-time`: the CPU milliseconds the current thread spends running a function, for tests that need a performance budget. Unlike `Date.now()` or `performance.now()`, it does not count time a loaded machine spends on other work, so a correct run does not fail its budget on a busy CI runner.

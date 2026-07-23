---
"@agent-native/core": patch
---

Pin scaffolded standalone apps' `@agent-native/core` and `@agent-native/toolkit` dependencies to the exact release pair this CLI was built and tested with, instead of the independently-moving npm `latest` dist-tag for each. Prevents `agent-native create` from installing a core/toolkit pair that were never released together, which could produce duplicate toolkit installs and "does not provide an export" errors at runtime.

---
"@agent-native/core": patch
---

Stop holding HTTP responses on telemetry exports: they go to the platform's background hook when it has one, and otherwise wait at most 250ms. Action change markers are still written before a write response returns, so polling clients see them.

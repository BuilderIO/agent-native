---
"@agent-native/core": patch
---

Stop holding write and HTTP responses on telemetry exports and action change markers: they go to the platform's background hook when it has one, and otherwise wait at most 250ms.

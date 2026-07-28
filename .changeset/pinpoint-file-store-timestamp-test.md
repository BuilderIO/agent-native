---
"@agent-native/pinpoint": patch
---

Test-only: the `FileStore.update()` spec now drives the clock with fake timers instead of assuming wall-clock advances between two back-to-back writes, which made it flake when both landed in the same millisecond. No runtime behavior change.

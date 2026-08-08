---
"@agent-native/core": patch
---

Keep the runs tray refreshing while a run still reads as active, so a run
abandoned mid-flight (budget exhausted, dead worker) can no longer spin
indefinitely in hosts that disable idle polling with `pollMs={0}`.

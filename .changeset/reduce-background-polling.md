---
"@agent-native/core": patch
---

Reduce background polling: dynamic suggestions now event-driven with a slow safety net, run-stuck detection only polls the active chat tab, runs tray polls at 3s.

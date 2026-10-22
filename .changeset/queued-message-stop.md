---
"@agent-native/core": patch
---

Stopping a promoted queued chat message now cancels its submitted run durably, while stopping during promotion prevents that receipt from being submitted.

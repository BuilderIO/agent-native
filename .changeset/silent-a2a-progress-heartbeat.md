---
"@agent-native/core": patch
---

Surface real remote liveness during cross-app agent calls (call-agent): while the A2A poll waits on another app, each successful poll that reports the remote still working now keeps progress moving, so a slow-but-healthy sub-agent no longer triggers a false "no progress" stuck warning whose Retry button aborts the healthy call and re-runs it from scratch. A hung or unresponsive remote still emits nothing, so the stuck warning correctly appears.

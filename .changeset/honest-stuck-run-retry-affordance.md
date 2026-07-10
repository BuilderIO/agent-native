---
"@agent-native/core": patch
---

Stop the stuck-run banner's Retry button from aborting a run that still has a live tool call or sub-agent (A2A) `call agent` in flight — a slow provider query or cross-app call can legitimately go minutes without emitting progress, and Retry previously killed that work and re-executed it from scratch. When `AssistantChat`'s new `hasInFlightWork()` reports live work, `RunStuckBanner` hides Retry and offers only an explicit, clearly-labeled Cancel; auto-retry is likewise suppressed. `MultiTabAssistantChat` wires this through automatically.

---
"@agent-native/core": patch
---

Record `agent_connected` and take its one-time reconnect claim only when first-party Agent-Native analytics is enabled, so a deployment that tracks only through PostHog, Mixpanel, Amplitude or a webhook doesn't use up the claim before first-party analytics can receive the event.

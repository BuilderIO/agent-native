---
"@agent-native/core": patch
---

Browser telemetry URL scrubbing now redacts the signed `agent_access` query token, so opening an agent-access link in a tracked app no longer copies its bearer into pageview, referrer, error-report or session-replay URLs.

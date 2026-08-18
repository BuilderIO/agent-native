---
"@agent-native/core": patch
---

Record what was sent when an agent run errors. An errored run's capture now
carries the failed request's model, payload bytes, tool count, and message
count alongside `gatewayRequestId` — sizes and counts only, never prompt or
user content — so an oversized request and an upstream outage stop producing
identical, undiagnosable captures.

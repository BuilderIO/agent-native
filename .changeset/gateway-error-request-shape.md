---
"@agent-native/core": patch
---

Name the AI provider in gateway internal-error text, and record what was sent
when a run errors. A Builder gateway 500 now reads as the model service
failing rather than the app breaking, keeping its `ERROR ID:` reference, and an
errored run's capture carries the request's model, payload bytes, tool count,
and message count alongside `gatewayRequestId` — sizes and counts only, never
prompt or user content.

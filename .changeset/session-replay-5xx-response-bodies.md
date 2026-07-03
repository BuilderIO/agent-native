---
"@agent-native/core": minor
---

Session replay network capture now records a bounded, redacted response-body snippet for 5xx (server error) responses, so agents can see the actual server error message. Request bodies and headers are still never captured, and non-5xx or network-failure responses never carry a body. Configurable via `sessionReplay.network.captureErrorBodies` (default `true`) and `maxErrorBodyLength` (default 2048 chars).

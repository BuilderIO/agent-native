---
"@agent-native/core": patch
---

Mark an action write response with `X-Agent-Native-Change-Marker: failed` when its durable change marker did not persist, keeping the response a success, and refresh action queries on the client when that header arrives.

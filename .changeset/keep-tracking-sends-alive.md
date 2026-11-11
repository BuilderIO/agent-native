---
"@agent-native/core": patch
---

Server analytics sends on serverless now outlive the response: a send started when an event is tracked is handed to the host's `waitUntil`, and the end-of-request flush waits for every send still under way.

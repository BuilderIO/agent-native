---
"@agent-native/core": patch
---

Record a bounded `http.route` on every `http.server.request.duration` point and `http.server` span: framework endpoints get their route template (`/_agent-native/auth/session`, `/_agent-native/agent-chat/runs/:runId/events`), app file routes their Nitro template, and everything else a fixed bucket (`/_agent-native/*`, `/api/*`, `static`, `page`, `other`), so 4xx traffic can be attributed to an endpoint without recording raw paths.

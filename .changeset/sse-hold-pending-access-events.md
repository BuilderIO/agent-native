---
"@agent-native/core": patch
---

Fix live-stream collaboration updates that arrived 15-55 seconds late. The `/_agent-native/events` stream dropped a collaborator's first event for a resource whenever that user's cached access had expired (every 30 seconds), leaving recovery to a much later poll. The stream now waits for the running access check and keeps events in order behind it, and closes the stream so the client re-polls if the check outlasts 10 seconds.

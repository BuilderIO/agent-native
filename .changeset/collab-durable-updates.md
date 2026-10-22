---
"@agent-native/core": patch
---

`useCollaborativeDoc` can keep a doc's unacknowledged updates in localStorage. Pass `durableUpdates: true` and the edits survive a refresh, a closed tab, or a stretch offline: they are sent again when the doc next opens for the same account, and as soon as the browser is back online. `durableUpdatesFailed` turns true when the browser refuses to store an update. `onUpdateAcknowledged` receives each server acknowledgment, including its live-copy outcome, only while its original document and account subscription remains active. In durable mode, an update the server refuses as too large (HTTP 413) is no longer resent forever: a refused batch of updates is sent in halves, and once a single update is refused the client stops sending updates and `updatesRefused` turns true, with the updates still unacknowledged and kept. Other callers retain their existing retry behavior.

Applications that depend on live-copy derivation can also pass `requireLiveCopyOutcome: true`. Missing or unreadable outcomes leave updates pending, including in the durable outbox, until a known outcome reaches the owning subscription. This requirement stays with the connection through unsubscribe and its final keepalive; callers that do not opt in retain nullable acknowledgments.

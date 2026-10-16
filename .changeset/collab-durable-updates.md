---
"@agent-native/core": patch
---

`useCollaborativeDoc` can keep a doc's unacknowledged updates in localStorage. Pass `durableUpdates: true` and the edits survive a refresh, a closed tab, or a stretch offline: they are sent again when the doc next opens for the same account, and as soon as the browser is back online. `durableUpdatesFailed` turns true when the browser refuses to store an update. `onUpdateAcknowledged` receives each server acknowledgment, including its live-copy outcome.

---
"@agent-native/core": patch
---

Serialize event-subscription refreshes so a snapshot taken before a concurrent define or delete can no longer unsubscribe the newer automation. An interleaved refresh could leave an event automation without a bus subscription, silently dropping every event it should have received until the next refresh or process restart.

---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

Agent turns now keep the screen they were sent from. Each chat message carries its tab's `navigation`, `__url__`, `settings-view`, and `selection` values, and for the whole turn (including queued messages, background runs, and continuations) server reads of those keys for that tab return the sent values, so `<current-screen>`, `view-screen`, and actions agree with what the user saw even if they click elsewhere. The turn reads live state again once it navigates. Apps register extra per-tab screen keys with `registerAgentScreenStateKeys()` from `@agent-native/core/client/application-state`.

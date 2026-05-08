---
"@agent-native/core": patch
---

Pause `useDbSync`, `useScreenRefreshKey`, `usePausingInterval`, and `useCollaborativeDoc` polling while the tab is hidden so background tabs do not keep waking the network. Restores polling on focus and visibility change. The new `pauseWhenHidden` option defaults to `true`; pass `false` to keep the legacy always-on behaviour. Also expand `useDbSync`'s default invalidation set to include `app-state`, `navigate-command`, `show-questions`, and `__set_url__`, so framework-managed application-state keys stay in sync without templates having to opt in by passing `queryKeys`. The `/_agent-native/poll` endpoint now subscribes to in-process `app-state` and `settings` emitters and records changes directly, skipping a DB scan when the event happened on the same Node instance, and forwards an `owner` field on every event so clients can match it to the active session.

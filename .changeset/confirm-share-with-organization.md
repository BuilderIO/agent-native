---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Ask for confirmation before a resource becomes visible to the whole organization. `ShareButton` and `ShareDialog` now hold a private-to-Organization change until it is confirmed; Cancel leaves the saved access and cache untouched, and a failed save stays open to retry. Core adds `useShareVisibilityTransition` (request, confirm, cancel) and the toolkit adds `ShareVisibilityConfirmDialog` and `ShareGeneralAccessRow` for apps that compose their own sharing surface. `useShareButtonController.handleVisibilityChange` stays as a deprecated alias for `visibilityTransition.request`, so it also waits for confirmation; its promise resolves once the change is saved, rejects when a direct save fails, and for a held change stays pending through confirmation failures (retry is possible) until it saves or is cancelled or invalidated (`ShareVisibilityNotSavedError`). Visibility requests from a closed surface are ignored, and a pending visibility change never carries over to another resource. Saved share and visibility changes to chats also refresh the chat history lists.

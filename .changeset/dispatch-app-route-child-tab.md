---
"@agent-native/dispatch": patch
---

Make an embedded app's chat rail on `/dispatch/apps/:appId` send the app frame's own browser tab id instead of Dispatch's, so asking the app chat to open something navigates the app frame instead of bouncing Dispatch to its overview.

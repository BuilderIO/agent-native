---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add a real "Delete chat" action to the sidebar chat history rail, distinct from "Archive chat", with a destructive confirmation dialog. Fixes `removeThread` silently reporting success on a failed delete request.

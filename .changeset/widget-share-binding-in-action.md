---
"@agent-native/core": patch
---

Bind the sharing actions (share, unshare, set visibility, list shares) to the widget write grant's own resource inside the action, and return a directory tool result without a widget session ticket instead of failing after the action ran when no widget scope fits the size limits.

---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Dispatch's home page checks which workspace apps you can open in a handful of database queries instead of about a dozen per app, so the app list no longer slows down as the workspace grows. Core gains `resolveAccessMany` to check many resources of one type at once, with the same results as `resolveAccess`.

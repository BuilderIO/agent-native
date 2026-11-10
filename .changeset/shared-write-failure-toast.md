---
"@agent-native/core": minor
"@agent-native/toolkit": minor
"@agent-native/dispatch": patch
---

Show one shared toast when a save fails instead of failing silently. `useActionMutation` now announces a failed write that nothing else handles (`errorNotification: "auto" | "shared" | "caller"`, plus an `errorLabel` title), `@agent-native/core/client/write-failure` adds `reportWriteFailure` for writes that are not mutations, and `AppProviders` mounts the toast. A typed 4xx refusal shows its own message, offline, timeout and permission failures show translated text, and a 5xx stays generic. Background saves and mutations that render their own error opt out with `errorNotification: "caller"`.

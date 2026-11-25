---
"@agent-native/core": patch
---

A write that names no resources no longer refetches the theme-family read, so a second write can't cancel that refetch mid-flight (the browser reported it as an aborted get-theme-family request). The theme read still refreshes through its own app-state subscription.

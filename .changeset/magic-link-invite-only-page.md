---
"@agent-native/core": patch
---

On an invite-only workspace, someone without an invitation who opens a magic link now sees a page saying the workspace is invite-only, with a link back to sign in, instead of a raw JSON error. A magic link started from the desktop app tells the app the same thing instead of leaving it waiting.

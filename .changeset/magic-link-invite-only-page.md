---
"@agent-native/core": patch
"@agent-native/mobile-app": patch
---

On an invite-only workspace, someone without an invitation who opens a magic link now sees a page saying the workspace is invite-only, with a link back to sign in, instead of a raw JSON error. A magic link started from the desktop app tells the app the same thing instead of leaving it waiting. The mobile app now sends its magic-link verifier in a request header, as the server requires, so its magic-link sign-in completes and shows the same invite-only message.

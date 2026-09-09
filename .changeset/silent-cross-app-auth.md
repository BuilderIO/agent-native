---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Keep Google and email authentication as the only visible sign-in choices while optionally bootstrapping a Dispatch session and local cross-app session after sign-in. The handoff uses a short-lived, one-time server-side handle and preserves existing local accounts and cookies.

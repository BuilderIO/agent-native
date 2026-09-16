---
"@agent-native/core": patch
---

Persist the auto-generated local development auth secret in `<app>/.agent-native/dev-auth-secret` (mode 0600, created exclusively, reused across restarts, never written into env files) so local sign-in sessions and the auto-created dev account survive dev-server restarts, and make the workspace dev gateway print its root directory, the real per-app URLs, and an explicit notice when its requested port is already in use.

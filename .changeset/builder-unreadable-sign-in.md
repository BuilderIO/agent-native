---
"@agent-native/core": patch
---

Report a stored Builder.io sign-in that this deployment's encryption key cannot open as `builder_credential_unreadable`, instead of as an expired sign-in (`builder_auth_error`, "Sign in to Builder.io again"). A database copied from another deployment, or a rotated key, now says so.

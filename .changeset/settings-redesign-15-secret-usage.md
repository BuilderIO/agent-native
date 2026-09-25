---
"@agent-native/core": minor
---

Registered and ad-hoc secrets now report `usedFor` (what each key powers, per app and feature) and `managedBy` (the Settings page that owns a key). Add `GET /_agent-native/secrets/:key/usage` and the `preview-secret-removal` action to preview what stops or switches when a key is removed, including model picker and default model effects. Deleting a managed key (Builder.io credentials, S3 storage fields, channel tokens, calendar tokens) from the secrets routes now returns 409 naming its owner unless the owner surface passes `?managedBy=<id>`.

API keys now shows managed keys read-only with their owner, and each channel under Integrations can remove its stored credentials.

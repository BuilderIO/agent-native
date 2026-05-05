---
"@agent-native/core": patch
---

Unify request-scoped secret resolution to read user → org → workspace rows from `app_secrets` everywhere. Previously, chat engine detection, `getOwnerApiKey()`, `resolveSecret()`, voice provider status, transcribe-voice, and Google Realtime each had their own slightly different read order — some only checked the user row, some checked user + org but not workspace. They now all walk the same chain, so an org-shared (or workspace-scoped) key is honored consistently no matter which call site resolves it. Solo (no-org) sessions fall back to a `workspace:solo:<email>` row.

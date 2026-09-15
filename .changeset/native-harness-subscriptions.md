---
"@agent-native/core": minor
---

Use AI SDK Harness native host subscription authentication for built-in harness adapters and remove the local Codex auth-file copy path. This intentional breaking 0.x release requires removing existing `codexCliAuth` configuration and the `CodexCliAuthConfig` import; supported native subscription credentials are resolved on the host by the upstream harness adapter.

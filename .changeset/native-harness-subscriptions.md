---
"@agent-native/core": major
---

Use AI SDK Harness native host subscription authentication for built-in harness adapters and remove the local Codex auth-file copy path. This is a breaking release: remove existing `codexCliAuth` configuration and the `CodexCliAuthConfig` import; supported native subscription credentials are resolved on the host by the upstream harness adapter.
